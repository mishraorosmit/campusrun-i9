import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IGeospatialService } from './IGeospatialService';
import { IAuditService } from './IAuditService';
import { SpawnPoint } from '../domain/entities/SpawnPoint';
import { Coordinates, SvgCoordinates, SpawnTier, SpawnStatus } from '../domain/types';
import { GeoService } from '../infrastructure/geo/GeoService';
import { ValidationError } from '../errors/ValidationError';
import { NotFoundError } from '../errors/NotFoundError';
import { transactionManager } from '../infrastructure/database/transaction';

export interface EditSpawnInput {
  id: string;
  name?: string;
  points?: number;
  claimRadiusMeters?: number;
  coordinates?: Coordinates;
  svgCoordinates?: SvgCoordinates;
  enabled?: boolean;
  status?: SpawnStatus;
  code?: string;
  tier?: SpawnTier;
  description?: string | null;
  clue?: string | null;
  maxClaims?: number | null;
  minSeparationMeters?: number;
  adminId?: string | null;
}

export class AdminEditSpawnUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly geoService: IGeospatialService,
    private readonly auditService?: IAuditService
  ) {}

  public async execute(input: EditSpawnInput): Promise<SpawnPoint> {
    if (!input.id) {
      throw new ValidationError('Spawn ID is required for editing.');
    }

    const existing = await this.spawnRepo.findById(input.id);
    if (!existing) {
      throw new NotFoundError(`Spawn point "${input.id}" not found.`);
    }

    const minSeparation = input.minSeparationMeters ?? 15.0;
    let targetCoords = existing.coordinates;
    let targetSvg = existing.svgCoordinates;

    // 1. Validate updated coordinates if provided
    if (input.coordinates) {
      try {
        targetCoords = GeoService.validateCoordinates(input.coordinates);
      } catch (err: any) {
        throw new ValidationError(err.message, err.details);
      }

      const isInside = await this.geoService.isInsideCampus(targetCoords);
      if (!isInside) {
        throw new ValidationError(
          `Updated location (${targetCoords.lat}, ${targetCoords.lng}) is outside the authoritative campus boundary.`
        );
      }

      // Check separation from other spawns, excluding this spawn ID
      if (minSeparation > 0) {
        const nearbySpawns = await this.spawnRepo.findNearby(targetCoords, minSeparation);
        const conflicts = nearbySpawns.filter((s) => s.id !== existing.id);
        if (conflicts.length > 0) {
          const closest = conflicts[0];
          const dist = GeoService.distanceBetweenPoints(targetCoords, closest.coordinates);
          throw new ValidationError(
            `Spatial separation violation: Location is ${dist}m from existing spawn "${closest.title}" (${closest.code}), which violates the minimum separation of ${minSeparation}m.`
          );
        }
      }

      // If coordinates changed, update SVG
      targetSvg = this.geoService.gpsToSvg(targetCoords);
    }

    // 2. Validate SVG consistency if SVG coordinates supplied
    if (input.svgCoordinates) {
      let validatedSvg: SvgCoordinates;
      try {
        validatedSvg = GeoService.validateSvgCoordinates(input.svgCoordinates);
      } catch (err: any) {
        throw new ValidationError(err.message, err.details);
      }
      const canonicalSvg = this.geoService.gpsToSvg(targetCoords);

      const dx = Math.abs(validatedSvg.x - canonicalSvg.x);
      const dy = Math.abs(validatedSvg.y - canonicalSvg.y);
      const svgDeviation = Math.sqrt(dx * dx + dy * dy);

      if (svgDeviation > 35) {
        throw new ValidationError(
          `Inconsistent coordinates: Provided SVG coordinates (${validatedSvg.x}, ${validatedSvg.y}) deviate too far from physical GPS projection (${canonicalSvg.x}, ${canonicalSvg.y}).`
        );
      }
      targetSvg = validatedSvg;
    }

    // 3. Validate name / title if provided
    if (input.name !== undefined) {
      if (typeof input.name !== 'string' || input.name.trim().length === 0) {
        throw new ValidationError('Spawn name cannot be empty.');
      }
      if (input.name.trim().length > 100) {
        throw new ValidationError('Spawn name cannot exceed 100 characters.');
      }
    }

    // 4. Validate point value if provided
    if (input.points !== undefined) {
      if (typeof input.points !== 'number' || !Number.isInteger(input.points) || input.points <= 0) {
        throw new ValidationError(`Point value must be a positive integer greater than 0 (got ${input.points}).`);
      }
    }

    // 5. Validate claim radius if provided
    if (input.claimRadiusMeters !== undefined) {
      if (
        typeof input.claimRadiusMeters !== 'number' ||
        !Number.isFinite(input.claimRadiusMeters) ||
        input.claimRadiusMeters < 5.0 ||
        input.claimRadiusMeters > 150.0
      ) {
        throw new ValidationError(
          `Claim radius must be between 5.0 and 150.0 meters (got ${input.claimRadiusMeters}).`
        );
      }
    }

    // 6. Validate code if provided
    if (input.code !== undefined) {
      if (typeof input.code !== 'string' || input.code.trim().length < 3) {
        throw new ValidationError('Spawn code must be at least 3 characters.');
      }
    }

    // 7. Construct updated domain entity
    const updatedSpawn = existing.update({
      title: input.name !== undefined ? input.name.trim() : existing.title,
      code: input.code !== undefined ? input.code.trim().toUpperCase() : existing.code,
      points: input.points !== undefined ? input.points : existing.points,
      claimRadiusMeters: input.claimRadiusMeters !== undefined ? input.claimRadiusMeters : existing.claimRadiusMeters,
      coordinates: targetCoords,
      svgCoordinates: targetSvg,
      enabled: input.enabled !== undefined ? input.enabled : existing.isEnabled,
      status: input.status !== undefined ? input.status : existing.status,
      tier: input.tier !== undefined ? input.tier : existing.tier,
      description: input.description !== undefined ? input.description : existing.description,
      clue: input.clue !== undefined ? input.clue : existing.clue,
      maxClaims: input.maxClaims !== undefined ? input.maxClaims : existing.maxClaims,
    });

    // 8. Persist atomically
    let persistedSpawn: SpawnPoint;
    try {
      persistedSpawn = await transactionManager.runInTransaction(async (tx) => {
        return this.spawnRepo.update(updatedSpawn, tx);
      });
    } catch (err) {
      if (this.auditService) {
        await this.auditService.log({
          adminId: input.adminId || null,
          action: 'SPAWN_EDIT',
          targetEntity: 'spawn_points',
          targetId: existing.id,
          details: { result: 'FAILED', error: (err as Error).message },
          createdAt: new Date(),
        });
      }
      throw err;
    }

    // 9. Audit Logging
    if (this.auditService) {
      await this.auditService.log({
        adminId: input.adminId || null,
        action: 'SPAWN_EDIT',
        targetEntity: 'spawn_points',
        targetId: persistedSpawn.id,
        details: {
          result: 'SUCCESS',
          changes: {
            name: input.name,
            points: input.points,
            claimRadiusMeters: input.claimRadiusMeters,
            coordinates: input.coordinates,
            enabled: input.enabled,
          },
        },
        createdAt: new Date(),
      });
    }

    return persistedSpawn;
  }
}
