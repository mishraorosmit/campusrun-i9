import { ISpawnRepository } from '../repositories/ISpawnRepository';
import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { IClaimRepository } from '../repositories/IClaimRepository';
import { ILeaderboardRepository } from '../repositories/ILeaderboardRepository';
import { IEventBus } from '../events/IEventBus';
import { IGeofencingService, GeofencingRules, ClaimRules } from '../domain/rules';
import { Claim } from '../domain/entities/Claim';
import { SpawnClaimedEvent } from '../domain/events';
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
    private readonly eventBus: IEventBus
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
      throw new DomainError(ruleCheck.reason || 'Cannot claim spawn point', ErrorCodes.DOMAIN_ERROR);
    }

    // 5. Verify geofencing / claim radius
    const geofence = GeofencingRules.isWithinClaimRadius(input.playerCoordinates, spawn, this.geoCalculator);
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
      playerCoordinates: input.playerCoordinates,
      distanceAtClaimMeters: geofence.distanceMeters,
    });

    // 7. Persist claim and update player points
    await this.claimRepo.save(claim);
    await this.playerRepo.updatePoints(player.id, spawn.points);
    await this.leaderboardRepo.recordScore(player.id, spawn.points);

    // 8. Publish domain event
    await this.eventBus.publish(
      new SpawnClaimedEvent({
        claimId: claim.id,
        spawnId: spawn.id,
        spawnCode: spawn.code,
        playerId: player.id,
        pointsAwarded: spawn.points,
        playerLat: input.playerCoordinates.lat,
        playerLng: input.playerCoordinates.lng,
        zoneId: spawn.props.zoneId,
      })
    );

    return {
      success: true,
      claimId: claim.id,
      spawnCode: spawn.code,
      pointsAwarded: spawn.points,
      tier: spawn.props.tier,
      distanceMeters: geofence.distanceMeters,
      claimedAt: claim.claimedAt.toISOString(),
    };
  }
}
