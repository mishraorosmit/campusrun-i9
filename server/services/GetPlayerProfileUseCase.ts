import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { PlayerProfileDTO } from './dtos';
import { NotFoundError } from '../errors';

export class GetPlayerProfileUseCase {
  constructor(private readonly playerRepo: IPlayerRepository) {}

  public async execute(playerId: string): Promise<PlayerProfileDTO> {
    const player = await this.playerRepo.findById(playerId);
    if (!player) {
      throw new NotFoundError(`Player with id "${playerId}" not found`);
    }

    return {
      id: player.id,
      username: player.username,
      email: player.props.email,
      avatarUrl: player.props.avatarUrl,
      totalPoints: player.props.totalPoints,
      seasonPoints: player.props.seasonPoints,
      rank: player.props.rank,
      tier: player.props.tier,
      claimsCount: player.props.claimsCount,
      currentStreakDays: player.props.currentStreakDays,
      role: player.role,
    };
  }
}
