import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IGeospatialService } from './IGeospatialService';
import { IAuditService } from './IAuditService';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Coordinates, SvgCoordinates, SpawnTier } from '../domain/types';
import { GeoService } from '../infrastructure/geo/GeoService';
import { ValidationError } from '../errors/ValidationError';
import { transactionManager } from '../infrastructure/database/transaction';

export interface CreateSpawnInput {
  name: string;
  points: number;
  claimRadiusMeters?: number;
  coordinates: Coordinates;
  svgCoordinates?: SvgCoordinates;
  enabled?: boolean;
  code?: string;
  tier?: SpawnTier;
  description?: string;
  clue?: string;
  maxClaims?: number | null;
  minSeparationMeters?: number;
  adminId?: string | null;
}

export class AdminCreateSpawnUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly geoService: IGeospatialService,
    private readonly auditService?: IAuditService
  ) {}

  public async execute(input: CreateSpawnInput): Promise<SpawnPoint> {
    const minSeparation = input.minSeparationMeters ?? 15.0;

    // 1. Validate Coordinate object & numeric ranges
    let validatedCoords: Coordinates;
    try {
      validatedCoords = GeoService.validateCoordinates(input.coordinates);
    } catch (err: any) {
      throw new ValidationError(err.message, err.details);
    }

    // 2. Validate inside campus boundary
    const isInside = await this.geoService.isInsideCampus(validatedCoords);
    if (!isInside) {
      throw new ValidationError(
        `Spawn point location (${validatedCoords.lat}, ${validatedCoords.lng}) is outside the authoritative campus boundary.`
      );
    }

    // 3. Validate name / title
    const spawnName = (input.name || (input as any).title || '').trim();
    if (!spawnName) {
      throw new ValidationError('Spawn name is required and cannot be empty.');
    }
    if (spawnName.length > 100) {
      throw new ValidationError('Spawn name cannot exceed 100 characters.');
    }

    // 4. Validate point value
    if (typeof input.points !== 'number' || !Number.isInteger(input.points) || input.points <= 0) {
      throw new ValidationError(`Point value must be a positive integer greater than 0 (got ${input.points}).`);
    }

    // 5. Validate claim radius
    const radius = input.claimRadiusMeters ?? 25.0;
    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 5.0 || radius > 150.0) {
      throw new ValidationError(`Claim radius must be between 5.0 and 150.0 meters (got ${radius}).`);
    }

    // 6. Consistent GPS / SVG representation
    const canonicalSvg = this.geoService.gpsToSvg(validatedCoords);
    let finalSvg = canonicalSvg;

    if (input.svgCoordinates) {
      let validatedSvg: SvgCoordinates;
      try {
        validatedSvg = GeoService.validateSvgCoordinates(input.svgCoordinates);
      } catch (err: any) {
        throw new ValidationError(err.message, err.details);
      }
      // Validate consistency with GPS mapping
      const dx = Math.abs(validatedSvg.x - canonicalSvg.x);
      const dy = Math.abs(validatedSvg.y - canonicalSvg.y);
      const svgDeviation = Math.sqrt(dx * dx + dy * dy);

      // Canvas dimensions are 1572 x 2927; tolerance of 35 units (~1%)
      if (svgDeviation > 35) {
        throw new ValidationError(
          `Inconsistent coordinates: Provided SVG coordinates (${validatedSvg.x}, ${validatedSvg.y}) deviate too far from physical GPS projection (${canonicalSvg.x}, ${canonicalSvg.y}).`
        );
      }
      finalSvg = validatedSvg;
    }

    // 7. Validate minimum spatial separation from existing configured spawn points
    if (minSeparation > 0) {
      const nearbySpawns = await this.spawnRepo.findNearby(validatedCoords, minSeparation);
      if (nearbySpawns.length > 0) {
        const closest = nearbySpawns[0];
        const dist = GeoService.distanceBetweenPoints(validatedCoords, closest.coordinates);
        throw new ValidationError(
          `Spatial separation violation: Location is ${dist}m from existing spawn "${closest.title}" (${closest.code}), which violates the minimum separation of ${minSeparation}m.`
        );
      }
    }

    // 8. Generate code if omitted
    const code = input.code ? input.code.trim().toUpperCase() : `SPW-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // 9. Construct validated SpawnPoint domain entity
    const spawn = SpawnPoint.create({
      code,
      title: spawnName,
      description: input.description,
      clue: input.clue,
      coordinates: validatedCoords,
      svgCoordinates: finalSvg,
      points: input.points,
      tier: input.tier ?? 'tier1',
      claimRadiusMeters: radius,
      enabled: input.enabled !== undefined ? input.enabled : true,
      maxClaims: input.maxClaims,
    });

    // 10. Persist atomically
    let createdSpawn: SpawnPoint;
    try {
      createdSpawn = await transactionManager.runInTransaction(async (tx) => {
        return this.spawnRepo.create(spawn, tx);
      });
    } catch (err) {
      if (this.auditService) {
        await this.auditService.log({
          adminId: input.adminId || null,
          action: 'SPAWN_CREATE',
          targetEntity: 'spawn_points',
          targetId: spawn.id,
          details: { result: 'FAILED', error: (err as Error).message, name: input.name },
          createdAt: new Date(),
        });
      }
      throw err;
    }

    // 11. Audit Logging
    if (this.auditService) {
      await this.auditService.log({
        adminId: input.adminId || null,
        action: 'SPAWN_CREATE',
        targetEntity: 'spawn_points',
        targetId: createdSpawn.id,
        details: {
          result: 'SUCCESS',
          code: createdSpawn.code,
          name: createdSpawn.title,
          points: createdSpawn.points,
          radius: createdSpawn.claimRadiusMeters,
          coordinates: createdSpawn.coordinates,
          enabled: createdSpawn.isEnabled,
        },
        createdAt: new Date(),
      });
    }

    return createdSpawn;
  }
}
