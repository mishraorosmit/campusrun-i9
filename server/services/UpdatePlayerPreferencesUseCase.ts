import { IPlayerRepository } from '../repositories/IPlayerRepository';
import { ValidationError, NotFoundError } from '../errors';

export type PreferenceValue = string | number | boolean | null;
export type PreferencesMap = Record<string, PreferenceValue>;

export class UpdatePlayerPreferencesUseCase {
  constructor(private readonly playerRepo: IPlayerRepository) {}

  public async execute(playerId: string, rawBody: any): Promise<PreferencesMap> {
    this.validateShallowPreferences(rawBody);

    const player = await this.playerRepo.findById(playerId);
    if (!player) {
      throw new NotFoundError(`Player with id "${playerId}" not found`);
    }

    if (this.playerRepo.updatePreferences) {
      return await this.playerRepo.updatePreferences(playerId, rawBody);
    }

    const merged = {
      ...player.preferences,
      ...rawBody,
    };
    player.props.preferences = merged;
    await this.playerRepo.save(player);
    return merged;
  }

  public validateShallowPreferences(body: any): void {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ValidationError('Request body must be a shallow JSON object');
    }

    const keys = Object.keys(body);
    if (keys.length === 0) {
      throw new ValidationError('Preferences object cannot be empty');
    }

    for (const [key, value] of Object.entries(body)) {
      if (typeof key !== 'string' || key.trim() === '') {
        throw new ValidationError('Preference keys must be non-empty strings');
      }

      // Reject non-JSON values, arrays, nested objects, functions, undefined, symbols
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw new ValidationError(
          `Preference value for "${key}" must be a primitive value (string, number, boolean, or null). Nested objects and arrays are not allowed.`
        );
      }
    }
  }
}
