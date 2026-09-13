import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IBatchRepository } from '../repositories/IBatchRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { IGeospatialService } from './IGeospatialService';
import { Coordinates } from '../domain/types';
import { NotFoundError, DomainError, ValidationError } from '../errors';
import { ErrorCodes } from '../errors/ErrorCodes';
import { SchemaValidator } from '../validation/validator';

export interface ValidateClaimInput {
  spawnId: string;
  playerId: string;
  playerCoordinates: Coordinates;
}

export interface ClaimValidationResult {
  valid: true;
  spawnId: string;
  spawnCode: string;
  spawnTitle: string;
  points: number;
  claimRadiusMeters: number;
  playerId: string;
  batchId: string;
  distanceMeters: number;
  playerCoordinates: Coordinates;
  spawnCoordinates: Coordinates;
  validatedAt: Date;
}

export class ValidateClaimUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly batchRepo: IBatchRepository,
    private readonly claimRepo: IClaimRepository,
    private readonly geoService: IGeospatialService
  ) {}

  public async execute(input: ValidateClaimInput): Promise<ClaimValidationResult> {
    const { spawnId, playerId, playerCoordinates } = input;

    // 1. Validate request schema and coordinate ranges
    if (!spawnId || typeof spawnId !== 'string' || spawnId.trim().length === 0) {
      throw new ValidationError('Invalid spawn ID', [
        { field: 'spawnId', message: 'spawnId is required and must be a non-empty string' },
      ]);
    }

    if (!playerId || typeof playerId !== 'string' || playerId.trim().length === 0) {
      throw new ValidationError('Invalid player ID', [
        { field: 'playerId', message: 'playerId is required and must be a non-empty string' },
      ]);
    }

    if (
      !playerCoordinates ||
      !SchemaValidator.isLatitude(playerCoordinates.lat) ||
      !SchemaValidator.isLongitude(playerCoordinates.lng)
    ) {
      throw new ValidationError('Invalid player coordinates', [
        {
          field: 'coordinates',
          message: 'Valid coordinates are required with lat between -90 and 90 and lng between -180 and 180',
        },
      ]);
    }

    // 2. Fetch the spawn from the database
    const spawn = await this.spawnRepo.findById(spawnId);
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${spawnId}" not found`);
    }

    // 3. Verify spawn is enabled/claimable
    if (!spawn.isEnabled) {
      throw new DomainError(
        `Spawn point "${spawnId}" is disabled and cannot be claimed`,
        ErrorCodes.SPAWN_NOT_ACTIVE,
        { spawnId, enabled: false }
      );
    }

    if (spawn.status !== 'active') {
      throw new DomainError(
        `Spawn point "${spawnId}" is not active (current status: ${spawn.status})`,
        ErrorCodes.SPAWN_NOT_ACTIVE,
        { spawnId, status: spawn.status }
      );
    }

    // 4. Fetch the batch that this spawn is linked to
    if (!spawn.batchId) {
      throw new DomainError(
        `Spawn point "${spawnId}" does not belong to any active spawn batch`,
        ErrorCodes.SPAWN_NOT_ACTIVE,
        { spawnId }
      );
    }

    const batch = await this.batchRepo.findById(spawn.batchId);
    if (!batch) {
      throw new DomainError(
        `Spawn point "${spawnId}" does not belong to any valid spawn batch`,
        ErrorCodes.SPAWN_NOT_ACTIVE,
        { spawnId, batchId: spawn.batchId }
      );
    }

    // 5. Verify batch and spawn have not expired
    const now = new Date();
    if (batch.status === 'EXPIRED' || batch.isExpired() || now >= batch.expiresAt || spawn.isExpired) {
      throw new DomainError(
        `Spawn point "${spawnId}" or batch "${batch.id}" has expired`,
        ErrorCodes.SPAWN_EXPIRED,
        {
          spawnId,
          batchId: batch.id,
          expiresAt: batch.expiresAt.toISOString(),
          batchStatus: batch.status,
          spawnExpired: spawn.isExpired,
        }
      );
    }

    // Verify batch is ACTIVE and is currently the active batch
    const activeBatch = await this.batchRepo.findActive();
    if (batch.status !== 'ACTIVE' || !activeBatch || activeBatch.id !== batch.id) {
      throw new DomainError(
        `Spawn point "${spawnId}" does not belong to the currently active batch`,
        ErrorCodes.SPAWN_NOT_ACTIVE,
        { spawnId, batchId: spawn.batchId, batchStatus: batch.status, activeBatchId: activeBatch?.id }
      );
    }

    // 6. Verify player has not already claimed it in the active batch
    const alreadyClaimed = await this.claimRepo.hasClaimed(spawn.id, playerId, batch.id);
    if (alreadyClaimed) {
      throw new DomainError(
        `Spawn point "${spawn.code}" has already been claimed by this player in the active batch`,
        ErrorCodes.ALREADY_CLAIMED,
        { spawnId: spawn.id, playerId, batchId: batch.id }
      );
    }

    // 7. Calculate distance SERVER-SIDE using the authoritative geospatial service
    const distanceMeters = this.geoService.distanceMeters(playerCoordinates, spawn.coordinates);

    // 8. Verify distance <= authoritative spawn claim radius
    const authoritativeRadius = spawn.claimRadiusMeters;
    if (distanceMeters > authoritativeRadius) {
      throw new DomainError(
        `Player is out of range (${distanceMeters.toFixed(1)}m away; maximum radius is ${authoritativeRadius.toFixed(1)}m)`,
        ErrorCodes.OUT_OF_RANGE,
        {
          distanceMeters,
          claimRadiusMeters: authoritativeRadius,
          spawnCoordinates: spawn.coordinates,
          playerCoordinates,
        }
      );
    }

    // 9. Return structured validation result
    return {
      valid: true,
      spawnId: spawn.id,
      spawnCode: spawn.code,
      spawnTitle: spawn.props.title,
      points: spawn.points,
      claimRadiusMeters: authoritativeRadius,
      playerId,
      batchId: batch.id,
      distanceMeters,
      playerCoordinates,
      spawnCoordinates: spawn.coordinates,
      validatedAt: now,
    };
  }
}
