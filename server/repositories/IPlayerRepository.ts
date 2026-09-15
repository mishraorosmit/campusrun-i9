import { Player } from '../domain/entities/Player';
import { ITransactionContext } from './ITransactionManager';

export interface IPlayerRepository {
  findById(id: string): Promise<Player | null>;
  findByEmail(email: string): Promise<Player | null>;
  findByUsername(username: string): Promise<Player | null>;
  save(player: Player): Promise<void>;
  updatePoints(id: string, additionalPoints: number): Promise<void>;
  updatePointsTx(id: string, additionalPoints: number, tx: ITransactionContext): Promise<void>;
  incrementStreak(id: string): Promise<void>;
  updatePreferences?(id: string, preferences: Record<string, string | number | boolean | null>): Promise<Record<string, string | number | boolean | null>>;
  findAllUserIds?(): Promise<string[]>;
  findAll?(): Promise<Player[]>;
}
