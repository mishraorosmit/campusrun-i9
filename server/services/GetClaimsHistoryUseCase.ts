import { IClaimRepository } from '../repositories/IClaimRepository';
import { ClaimSummaryDTO } from './dtos';

export class GetClaimsHistoryUseCase {
  constructor(private readonly claimRepo: IClaimRepository) {}

  public async execute(playerId?: string, limit = 50): Promise<ClaimSummaryDTO[]> {
    const claims = playerId
      ? await this.claimRepo.findByPlayerId(playerId, limit)
      : await this.claimRepo.findRecent(limit);

    return claims.map((c) => ({
      id: c.id,
      spawnId: c.spawnId,
      spawnCode: c.props.spawnCode,
      spawnTitle: c.props.spawnTitle,
      pointsAwarded: c.pointsAwarded,
      claimedAt: c.claimedAt.toISOString(),
      tier: c.props.tier,
      distanceMeters: c.props.distanceAtClaimMeters,
    }));
  }
}
