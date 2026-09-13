import { IClaimRepository } from '../../../repositories/IClaimRepository';
import { Claim } from '../../../domain/entities/Claim';

export class InMemoryClaimRepository implements IClaimRepository {
  private claims: Map<string, Claim> = new Map();

  async findById(id: string): Promise<Claim | null> {
    return this.claims.get(id) || null;
  }

  async findByPlayerId(playerId: string, limit = 50): Promise<Claim[]> {
    return Array.from(this.claims.values())
      .filter((c) => c.playerId === playerId)
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime())
      .slice(0, limit);
  }

  async countBySpawnAndPlayer(spawnId: string, playerId: string, batchId?: string): Promise<number> {
    let count = 0;
    for (const claim of this.claims.values()) {
      if (claim.spawnId === spawnId && claim.playerId === playerId) {
        if (!batchId || (claim as any).batchId === batchId) {
          count++;
        }
      }
    }
    return count;
  }

  async hasClaimed(spawnId: string, playerId: string, batchId?: string): Promise<boolean> {
    const count = await this.countBySpawnAndPlayer(spawnId, playerId, batchId);
    return count > 0;
  }

  async save(claim: Claim): Promise<void> {
    this.claims.set(claim.id, claim);
  }

  async findRecent(limit = 20): Promise<Claim[]> {
    return Array.from(this.claims.values())
      .sort((a, b) => b.claimedAt.getTime() - a.claimedAt.getTime())
      .slice(0, limit);
  }
}
