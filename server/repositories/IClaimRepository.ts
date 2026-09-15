import { Claim } from '../domain/entities/Claim';
import { ITransactionContext } from './ITransactionManager';

export interface IClaimRepository {
  findById(id: string): Promise<Claim | null>;
  findByPlayerId(playerId: string, limit?: number): Promise<Claim[]>;
  countBySpawnAndPlayer(spawnId: string, playerId: string, batchId?: string): Promise<number>;
  hasClaimed(spawnId: string, playerId: string, batchId?: string): Promise<boolean>;
  save(claim: Claim): Promise<void>;
  saveTx(claim: Claim, tx: ITransactionContext): Promise<boolean>;
  findRecent(limit?: number): Promise<Claim[]>;
}
