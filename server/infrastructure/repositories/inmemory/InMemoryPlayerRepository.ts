import { IPlayerRepository } from '../../../repositories/IPlayerRepository';
import { Player } from '../../../domain/entities/Player';

export class InMemoryPlayerRepository implements IPlayerRepository {
  private players: Map<string, Player> = new Map();

  constructor(initialPlayers: Player[] = []) {
    for (const player of initialPlayers) {
      this.players.set(player.id, player);
    }
  }

  async findById(id: string): Promise<Player | null> {
    return this.players.get(id) || null;
  }

  async findByEmail(email: string): Promise<Player | null> {
    for (const player of this.players.values()) {
      if (player.props.email.toLowerCase() === email.toLowerCase()) {
        return player;
      }
    }
    return null;
  }

  async findByUsername(username: string): Promise<Player | null> {
    for (const player of this.players.values()) {
      if (player.props.username.toLowerCase() === username.toLowerCase()) {
        return player;
      }
    }
    return null;
  }

  async save(player: Player): Promise<void> {
    for (const [id, existing] of this.players.entries()) {
      if (existing.props.email.toLowerCase() === player.props.email.toLowerCase() && id !== player.id) {
        this.players.delete(id);
      }
    }
    this.players.set(player.id, player);
  }

  async updatePoints(id: string, additionalPoints: number): Promise<void> {
    const player = this.players.get(id);
    if (!player) return;

    const updated = new Player({
      ...player.props,
      totalPoints: player.props.totalPoints + additionalPoints,
      seasonPoints: player.props.seasonPoints + additionalPoints,
      claimsCount: player.props.claimsCount + 1,
      lastActiveAt: new Date(),
    });
    this.players.set(id, updated);
  }

  async incrementStreak(id: string): Promise<void> {
    const player = this.players.get(id);
    if (!player) return;

    const updated = new Player({
      ...player.props,
      currentStreakDays: player.props.currentStreakDays + 1,
      lastActiveAt: new Date(),
    });
    this.players.set(id, updated);
  }
}
