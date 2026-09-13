import crypto from 'crypto';
import { IGeospatialService } from './IGeospatialService';
import { IEventBus } from '../events/IEventBus';
import { eventBus } from '../events/EventBus';
import { ITransactionManager } from '../infrastructure/database/types';
import { transactionManager } from '../infrastructure/database/transaction';
import { Coordinates } from '../domain/types';
import { ClaimSuccessEvent } from '../domain/events';
import { NotFoundError, DomainError, ValidationError } from '../errors';
import { ErrorCodes } from '../errors/ErrorCodes';
import { SchemaValidator } from '../validation/validator';

export interface ExecuteClaimInput {
  spawnId: string;
  playerId: string;
  playerCoordinates: Coordinates;
}

export interface AuthoritativeClaimResult {
  claimId: string;
  spawnId: string;
  spawnName: string;
  spawnCode: string;
  pointsAwarded: number;
  weeklyPoints: number;
  allTimePoints: number;
  totalPoints: number;
  claimedAt: string;
  distanceMeters: number;
  weeklyRank: number | null;
  valid: true;
  playerId: string;
  batchId: string;
}

export class ClaimSpawnUseCase {
  constructor(
    private readonly geoService: IGeospatialService,
    private readonly eventBusInstance: IEventBus = eventBus,
    private readonly txManager: ITransactionManager = transactionManager
  ) {}

  public async execute(input: ExecuteClaimInput): Promise<AuthoritativeClaimResult> {
    const { spawnId, playerId, playerCoordinates } = input;

    // 0. Pre-flight schema validation
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

    // 1-8. Authoritative Atomic Database Transaction
    const claimTxResult = await this.txManager.runInTransaction(async (tx) => {
      // 1. Re-check critical spawn validity inside transaction with row lock
      const spawnRes = await tx.query<any>(
        `SELECT 
           id, code, title, description, clue, batch_id as "batchId",
           tier, points, claim_radius_meters as "claimRadiusMeters",
           lat, lng, status, enabled, claim_count as "claimCount",
           max_claims as "maxClaims"
         FROM spawn_points
         WHERE id = $1
         FOR UPDATE;`,
        [spawnId]
      );

      if (!spawnRes.rows || spawnRes.rows.length === 0) {
        throw new NotFoundError(`Spawn point "${spawnId}" not found`);
      }

      const spawn = spawnRes.rows[0];

      if (!spawn.enabled) {
        throw new DomainError(
          `Spawn point "${spawnId}" is disabled and cannot be claimed`,
          ErrorCodes.SPAWN_NOT_ACTIVE,
          { spawnId, enabled: false }
        );
      }

      if (spawn.status === 'expired') {
        throw new DomainError(
          `Spawn point "${spawnId}" has expired`,
          ErrorCodes.SPAWN_EXPIRED,
          { spawnId, status: spawn.status }
        );
      }

      if (spawn.status !== 'active') {
        throw new DomainError(
          `Spawn point "${spawnId}" is not active (status: ${spawn.status})`,
          ErrorCodes.SPAWN_NOT_ACTIVE,
          { spawnId, status: spawn.status }
        );
      }

      if (spawn.maxClaims !== null && spawn.maxClaims !== undefined && spawn.claimCount >= spawn.maxClaims) {
        throw new DomainError(
          `Spawn point "${spawn.code}" has reached its maximum claim limit (${spawn.maxClaims})`,
          ErrorCodes.CLAIM_LIMIT_REACHED,
          { spawnId, claimCount: spawn.claimCount, maxClaims: spawn.maxClaims }
        );
      }

      if (!spawn.batchId) {
        throw new DomainError(
          `Spawn point "${spawnId}" does not belong to any active spawn batch`,
          ErrorCodes.SPAWN_NOT_ACTIVE,
          { spawnId }
        );
      }

      // Check batch validity and expiration under transaction
      const batchRes = await tx.query<any>(
        `SELECT id, cycle_id as "cycleId", batch_number as "batchNumber",
                started_at as "startedAt", expires_at as "expiresAt", status, is_active as "isActive"
         FROM spawn_batches
         WHERE id = $1;`,
        [spawn.batchId]
      );

      if (!batchRes.rows || batchRes.rows.length === 0) {
        throw new DomainError(
          `Spawn point "${spawnId}" does not belong to any valid spawn batch`,
          ErrorCodes.SPAWN_NOT_ACTIVE,
          { spawnId, batchId: spawn.batchId }
        );
      }

      const batch = batchRes.rows[0];
      const now = new Date();
      const batchExpiresAt = new Date(batch.expiresAt);

      if (batch.status === 'EXPIRED' || now >= batchExpiresAt) {
        throw new DomainError(
          `Spawn point "${spawnId}" or batch "${batch.id}" has expired`,
          ErrorCodes.SPAWN_EXPIRED,
          {
            spawnId,
            batchId: batch.id,
            expiresAt: batchExpiresAt.toISOString(),
          }
        );
      }

      if (batch.status !== 'ACTIVE' || !batch.isActive) {
        throw new DomainError(
          `Spawn point "${spawnId}" does not belong to the currently active batch`,
          ErrorCodes.SPAWN_NOT_ACTIVE,
          { spawnId, batchId: spawn.batchId, batchStatus: batch.status }
        );
      }

      // 2. Prevent duplicate player+spawn claims (fast pre-check inside tx)
      const existingClaimRes = await tx.query(
        `SELECT id FROM claims WHERE player_id = $1 AND spawn_id = $2 AND batch_id = $3 LIMIT 1;`,
        [playerId, spawnId, batch.id]
      );
      if (existingClaimRes.rowCount && existingClaimRes.rowCount > 0) {
        throw new DomainError(
          `Spawn point "${spawn.code}" has already been claimed by this player in the active batch`,
          ErrorCodes.ALREADY_CLAIMED,
          { spawnId, playerId, batchId: batch.id }
        );
      }

      // 3. Calculate / verify authoritative server-side distance
      const spawnCoords: Coordinates = {
        lat: Number(spawn.lat),
        lng: Number(spawn.lng),
      };
      const distanceMeters = this.geoService.distanceMeters(playerCoordinates, spawnCoords);
      const authoritativeRadius = Number(spawn.claimRadiusMeters);

      if (distanceMeters > authoritativeRadius) {
        throw new DomainError(
          `Player is out of range (${distanceMeters.toFixed(1)}m away; maximum radius is ${authoritativeRadius.toFixed(1)}m)`,
          ErrorCodes.OUT_OF_RANGE,
          {
            distanceMeters,
            claimRadiusMeters: authoritativeRadius,
            playerCoordinates,
            spawnCoordinates: spawnCoords,
          }
        );
      }

      // 4. Create the claim record (with duplicate constraint protection)
      const claimId = crypto.randomUUID();
      const authoritativePoints = Number(spawn.points);

      try {
        await tx.query(
          `INSERT INTO claims (
             id, player_id, spawn_id, batch_id, points_awarded, streak_multiplier,
             distance_meters, player_location, claimed_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6,
             $7, point($8, $9), NOW()
           );`,
          [
            claimId,
            playerId,
            spawnId,
            batch.id,
            authoritativePoints,
            1.00,
            distanceMeters,
            playerCoordinates.lng,
            playerCoordinates.lat,
          ]
        );
      } catch (insertErr: any) {
        if (
          insertErr?.code === '23505' ||
          insertErr?.constraint === 'uq_claims_player_spawn_batch' ||
          insertErr?.details?.constraint === 'uq_claims_player_spawn_batch'
        ) {
          throw new DomainError(
            `Spawn point "${spawn.code}" has already been claimed by this player in the active batch`,
            ErrorCodes.ALREADY_CLAIMED,
            { spawnId, playerId, batchId: batch.id }
          );
        }
        throw insertErr;
      }

      // Increment spawn claim count
      await tx.query(
        `UPDATE spawn_points SET claim_count = claim_count + 1, updated_at = NOW() WHERE id = $1;`,
        [spawnId]
      );

      // 5, 6, 7. Award points & update weekly and all-time points in player profile
      const profileRes = await tx.query<{
        total_points: number;
        season_points: number;
        claims_count: number;
      }>(
        `UPDATE profiles
         SET total_points = total_points + $2,
             season_points = season_points + $2,
             claims_count = claims_count + 1,
             last_active_at = NOW(),
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING total_points, season_points, claims_count;`,
        [playerId, authoritativePoints]
      );

      if (!profileRes.rows || profileRes.rows.length === 0) {
        throw new NotFoundError(`Player profile for user "${playerId}" not found.`);
      }

      const updatedProfile = profileRes.rows[0];

      // Query resulting weekly rank using window function
      let weeklyRank: number | null = null;
      try {
        const rankRes = await tx.query<{ rank: string }>(
          `SELECT rank FROM (
             SELECT user_id, RANK() OVER (ORDER BY season_points DESC, updated_at ASC) as rank
             FROM profiles
           ) r WHERE user_id = $1;`,
          [playerId]
        );
        if (rankRes.rows && rankRes.rows.length > 0) {
          weeklyRank = parseInt(rankRes.rows[0].rank, 10);
        }
      } catch {
        weeklyRank = null;
      }

      const claimedAt = new Date();

      return {
        claimId,
        spawnId,
        spawnName: spawn.title,
        spawnCode: spawn.code,
        pointsAwarded: authoritativePoints,
        weeklyPoints: Number(updatedProfile.season_points),
        allTimePoints: Number(updatedProfile.total_points),
        totalPoints: Number(updatedProfile.total_points),
        claimedAt: claimedAt.toISOString(),
        claimedAtDate: claimedAt,
        distanceMeters,
        weeklyRank,
        valid: true as const,
        playerId,
        batchId: batch.id,
        playerCoordinates,
      };
    });

    // 8. Emit CLAIM_SUCCESS domain event AFTER transaction commits successfully
    await this.eventBusInstance.publish(
      new ClaimSuccessEvent({
        claimId: claimTxResult.claimId,
        spawnId: claimTxResult.spawnId,
        spawnName: claimTxResult.spawnName,
        spawnCode: claimTxResult.spawnCode,
        playerId: claimTxResult.playerId,
        pointsAwarded: claimTxResult.pointsAwarded,
        weeklyPoints: claimTxResult.weeklyPoints,
        allTimePoints: claimTxResult.allTimePoints,
        claimedAt: claimTxResult.claimedAtDate,
        distanceMeters: claimTxResult.distanceMeters,
        weeklyRank: claimTxResult.weeklyRank,
        playerCoordinates: claimTxResult.playerCoordinates,
      })
    );

    // Return authoritative result containing only server-derived values
    return {
      claimId: claimTxResult.claimId,
      spawnId: claimTxResult.spawnId,
      spawnName: claimTxResult.spawnName,
      spawnCode: claimTxResult.spawnCode,
      pointsAwarded: claimTxResult.pointsAwarded,
      weeklyPoints: claimTxResult.weeklyPoints,
      allTimePoints: claimTxResult.allTimePoints,
      totalPoints: claimTxResult.totalPoints,
      claimedAt: claimTxResult.claimedAt,
      distanceMeters: claimTxResult.distanceMeters,
      weeklyRank: claimTxResult.weeklyRank,
      valid: true,
      playerId: claimTxResult.playerId,
      batchId: claimTxResult.batchId,
    };
  }
}
