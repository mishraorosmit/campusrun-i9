import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { ITransactionManager } from '../repositories/ITransactionManager';
import { IEventBus } from '../events/IEventBus';
import { IRealtimeService } from './IRealtimeService';
import { IGeofencingService, GeofencingRules, ClaimRules } from '../domain/rules';
import { Claim } from '../domain/entities/Claim';
import { SpawnClaimedEvent, RankChangedEvent } from '../domain/events';
import { SubmitClaimInputDTO, ClaimResultDTO } from './dtos';
import { NotFoundError, DomainError } from '../errors';
import { ErrorCodes } from '../errors/ErrorCodes';

export class ClaimSpawnUseCase {
  constructor(
    private readonly spawnRepo: ISpawnRepository,
    private readonly playerRepo: IPlayerRepository,
    private readonly claimRepo: IClaimRepository,
    private readonly leaderboardRepo: ILeaderboardRepository,
    private readonly geoCalculator: IGeofencingService,
    private readonly eventBus: IEventBus,
    private readonly txManager: ITransactionManager,
    private readonly realtimeService?: IRealtimeService
  ) {}

  public async execute(input: SubmitClaimInputDTO): Promise<ClaimResultDTO> {
    // 1. Fetch Spawn
    const spawn = await this.spawnRepo.findById(input.spawnId);
    if (!spawn) {
      throw new NotFoundError(`Spawn point "${input.spawnId}" not found`);
    }

    // 2. Fetch Player
    const player = await this.playerRepo.findById(input.playerId);
    if (!player) {
      throw new NotFoundError(`Player "${input.playerId}" not found`);
    }

    // 3. Check existing claims for this player on this spawn
    const existingClaimsCount = await this.claimRepo.countBySpawnAndPlayer(input.spawnId, input.playerId);

    // 4. Validate claim rules
    const ruleCheck = ClaimRules.validateCanClaim(spawn, existingClaimsCount);
    if (!ruleCheck.canClaim) {
      const isAlreadyClaimed = ruleCheck.reason?.includes('already claimed');
      const isExpired = ruleCheck.reason?.includes('expired');
      const isNotActive = ruleCheck.reason?.includes('not active');
      throw new DomainError(
        ruleCheck.reason || 'Cannot claim spawn point',
        isAlreadyClaimed
          ? ErrorCodes.ALREADY_CLAIMED
          : isExpired
          ? ErrorCodes.SPAWN_EXPIRED
          : isNotActive
          ? ErrorCodes.SPAWN_NOT_ACTIVE
          : ErrorCodes.DOMAIN_ERROR
      );
    }

    // 5. Determine coordinates and verify geofencing / claim radius
    const playerCoords =
      input.playerCoordinates &&
      typeof input.playerCoordinates.lat === 'number' &&
      typeof input.playerCoordinates.lng === 'number' &&
      !isNaN(input.playerCoordinates.lat) &&
      !isNaN(input.playerCoordinates.lng)
        ? input.playerCoordinates
        : spawn.coordinates;

    const geofence = GeofencingRules.isWithinClaimRadius(playerCoords, spawn, this.geoCalculator);
    if (!geofence.isWithin) {
      throw new DomainError(
        `Player is out of range (${geofence.distanceMeters}m away; maximum radius is ${spawn.claimRadiusMeters}m)`,
        ErrorCodes.OUT_OF_RANGE,
        {
          distanceMeters: geofence.distanceMeters,
          claimRadiusMeters: spawn.claimRadiusMeters,
        }
      );
    }

    // 6. Create claim entity
    const claimId = `claim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const claim = new Claim({
      id: claimId,
      spawnId: spawn.id,
      spawnCode: spawn.code,
      spawnTitle: spawn.props.title,
      playerId: player.id,
      zoneName: spawn.props.zoneName,
      pointsAwarded: spawn.points,
      claimedAt: new Date(),
      tier: spawn.props.tier,
      playerCoordinates: playerCoords,
      distanceAtClaimMeters: geofence.distanceMeters,
    });

    // 7. Persist claim and update player points in a single transaction
    await this.txManager.runInTransaction(async (tx) => {
      const claimInserted = await this.claimRepo.saveTx(claim, tx);
      if (!claimInserted) {
        throw new DomainError('Player has already claimed this spawn point during the current rotation', ErrorCodes.ALREADY_CLAIMED);
      }
      await this.playerRepo.updatePointsTx(player.id, spawn.points, tx);
    });
    
    await this.leaderboardRepo.recordScore(player.id, spawn.points);

    // 8. Publish domain events (Strictly after transaction commit, wrapped in try/catch)
    try {
      await this.eventBus.publish(
        new SpawnClaimedEvent({
          claimId: claim.id,
          spawnId: spawn.id,
          spawnCode: spawn.code,
          playerId: player.id,
          pointsAwarded: spawn.points,
          playerLat: playerCoords.lat,
          playerLng: playerCoords.lng,
          zoneId: spawn.props.zoneId,
        })
      );
    } catch (err) {
      console.error('[ClaimSpawnUseCase] Error publishing SpawnClaimedEvent:', err);
    }

    // Check if player rank changed and emit RankChangedEvent if detectable
    try {
      if (this.leaderboardRepo.getPlayerWeeklyRank) {
        const newRank = await this.leaderboardRepo.getPlayerWeeklyRank(player.id);
        const oldRank = player.props.rank;
        if (newRank !== null && newRank !== undefined && newRank !== oldRank) {
          await this.eventBus.publish(
            new RankChangedEvent({
              playerId: player.id,
              username: player.username,
              oldRank: oldRank || null,
              newRank,
              points: (player.props.seasonPoints || 0) + spawn.points,
              period: 'weekly',
              timestamp: new Date(),
            })
          );
        }
      }
    } catch (err) {
      console.error('[ClaimSpawnUseCase] Error publishing RankChangedEvent:', err);
    }

    // 9. Realtime broadcast (Strictly after database commit)
    if (this.realtimeService) {
      // Broadcast anonymous public claim summary to campus_global room (NO PII)
      this.realtimeService.broadcastPublicClaim({
        spawnId: spawn.id,
        spawnCode: spawn.code,
        pointsAwarded: spawn.points,
        zoneName: spawn.props.zoneName,
        timestamp: claim.claimedAt.toISOString(),
      });

      // Emit full personal receipt to private user:<userId> room
      this.realtimeService.emitPersonalClaimSuccess(player.id, {
        claimId: claim.id,
        spawnId: spawn.id,
        spawnCode: spawn.code,
        playerId: player.id,
        pointsAwarded: spawn.points,
        newTotalPoints: (player.props.totalPoints || 0) + spawn.points,
        newSeasonPoints: (player.props.seasonPoints || 0) + spawn.points,
        claimedAt: claim.claimedAt.toISOString(),
      });

      // Broadcast lightweight leaderboard update signal to campus_global (Strictly NO full-state dump)
      this.realtimeService.broadcastLeaderboardUpdated({
        type: 'weekly',
        playerRankDelta: {
          playerId: player.id,
          points: spawn.points,
          newRank: 0,
        },
        updatedAt: claim.claimedAt.toISOString(),
      });
    }

    return {
      success: true,
      claimId: claim.id,
      spawnId: spawn.id,
      spawnCode: spawn.code,
      pointsAwarded: spawn.points,
      tier: spawn.props.tier,
      distanceMeters: geofence.distanceMeters,
      claimedAt: claim.claimedAt.toISOString(),
    };
  }
}
