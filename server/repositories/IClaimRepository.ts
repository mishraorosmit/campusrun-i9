import { Claim } from '../domain/entities/Claim';

export interface IClaimRepository {
  findById(id: string): Promise<Claim | null>;
  findByPlayerId(playerId: string, limit?: number): Promise<Claim[]>;
  countBySpawnAndPlayer(spawnId: string, playerId: string): Promise<number>;
  save(claim: Claim): Promise<void>;
  findRecent(limit?: number): Promise<Claim[]>;
}
