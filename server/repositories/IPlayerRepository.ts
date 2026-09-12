import { Player } from '../domain/entities/Player';

export interface IPlayerRepository {
  findById(id: string): Promise<Player | null>;
  findByEmail(email: string): Promise<Player | null>;
  findByUsername(username: string): Promise<Player | null>;
  save(player: Player): Promise<void>;
  updatePoints(id: string, additionalPoints: number): Promise<void>;
  incrementStreak(id: string): Promise<void>;
}
