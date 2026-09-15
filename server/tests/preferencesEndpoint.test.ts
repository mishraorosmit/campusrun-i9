import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../controllers/PlayerController';
import { GetPlayerProfileUseCase } from '../services/GetPlayerProfileUseCase';
import { UpdatePlayerPreferencesUseCase } from '../services/UpdatePlayerPreferencesUseCase';
import { InMemoryPlayerRepository } from '../infrastructure/repositories/inmemory/InMemoryPlayerRepository';
import { Player } from '../domain/entities/Player';
import { requireCurrentUser } from '../middlewares/auth';
import { JwtUtils } from '../infrastructure/auth/JwtUtils';
import { config } from '../config';

describe('PATCH /api/v1/me/preferences Endpoint & Use Case', () => {
  let playerRepo: InMemoryPlayerRepository;
  let getPlayerProfileUseCase: GetPlayerProfileUseCase;
  let updatePlayerPreferencesUseCase: UpdatePlayerPreferencesUseCase;
  let playerController: PlayerController;

  const player1 = new Player({
    id: 'user-pref-1',
    email: 'user1@campus.edu',
    username: 'user_one',
    displayName: 'User One',
    status: 'active',
    totalPoints: 500,
    seasonPoints: 100,
    rank: 1,
    tier: 'tier1',
    claimsCount: 5,
    currentStreakDays: 3,
    preferences: {
      soundEnabled: true,
      haptics: false,
      mapZoom: 15,
    },
    role: 'STUDENT',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    lastActiveAt: new Date('2026-09-13T00:00:00.000Z'),
  });

  const player2 = new Player({
    id: 'user-pref-2',
    email: 'user2@campus.edu',
    username: 'user_two',
    displayName: 'User Two',
    status: 'active',
    totalPoints: 300,
    seasonPoints: 50,
    rank: 2,
    tier: 'tier1',
    claimsCount: 2,
    currentStreakDays: 1,
    preferences: {
      soundEnabled: false,
      language: 'en',
    },
    role: 'STUDENT',
    createdAt: new Date('2026-09-02T00:00:00.000Z'),
    lastActiveAt: new Date('2026-09-13T00:00:00.000Z'),
  });

  beforeEach(() => {
    playerRepo = new InMemoryPlayerRepository([
      new Player({ ...player1.props }),
      new Player({ ...player2.props }),
    ]);
    getPlayerProfileUseCase = new GetPlayerProfileUseCase(playerRepo);
    updatePlayerPreferencesUseCase = new UpdatePlayerPreferencesUseCase(playerRepo);
    playerController = new PlayerController(getPlayerProfileUseCase, updatePlayerPreferencesUseCase);
  });

  describe('1. Authentication Guard', () => {
    it('should return 401 if unauthenticated request attempts to patch preferences', () => {
      const req: any = { headers: {} };
      const res: any = {};
      let errReceived: any = null;

      requireCurrentUser(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });

    it('should return 401 if req.user is absent in controller handler', async () => {
      const req: any = { body: { soundEnabled: true } };
      const res: any = { json() {} };
      let errReceived: any = null;

      await playerController.updatePreferences(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 401);
    });
  });

  describe('2. Request Body Validation (Shallow JSON Enforcement)', () => {
    it('should reject non-object body (array) with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-pref-1', email: 'user1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: ['soundEnabled', true],
      };
      const res: any = {};
      let errReceived: any = null;

      await playerController.updatePreferences(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /shallow JSON object/i);
    });

    it('should reject null body with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-pref-1', email: 'user1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: null,
      };
      const res: any = {};
      let errReceived: any = null;

      await playerController.updatePreferences(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
    });

    it('should reject empty object body with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-pref-1', email: 'user1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: {},
      };
      const res: any = {};
      let errReceived: any = null;

      await playerController.updatePreferences(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
    });

    it('should reject nested object values with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-pref-1', email: 'user1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: {
          audio: {
            music: true,
            effects: false,
          },
        },
      };
      const res: any = {};
      let errReceived: any = null;

      await playerController.updatePreferences(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
      assert.match(errReceived.message, /Nested objects and arrays are not allowed/i);
    });

    it('should reject array values with 400 ValidationError', async () => {
      const req: any = {
        user: { id: 'user-pref-1', email: 'user1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: {
          favoriteZones: ['zone-1', 'zone-2'],
        },
      };
      const res: any = {};
      let errReceived: any = null;

      await playerController.updatePreferences(req, res, (err) => {
        errReceived = err;
      });

      assert.ok(errReceived);
      assert.equal(errReceived.statusCode, 400);
    });
  });

  describe('3. Successful Preference Updates & Isolation', () => {
    it('should update and merge shallow preferences for the authenticated user only', async () => {
      const req: any = {
        user: { id: 'user-pref-1', email: 'user1@campus.edu', username: 'user_one', role: 'STUDENT' },
        body: {
          haptics: true,
          vibrationIntensity: 'high',
          batterySaver: false,
          customNote: null,
        },
      };

      let responseStatusCode = 200;
      let responseBody: any = null;
      const res: any = {
        status(code: number) {
          responseStatusCode = code;
          return this;
        },
        json(data: any) {
          responseBody = data;
          return this;
        },
      };

      let errReceived: any = null;
      await playerController.updatePreferences(req, res, (err) => {
        errReceived = err;
      });

      assert.equal(errReceived, null);
      assert.equal(responseStatusCode, 200);
      assert.equal(responseBody.success, true);
      assert.ok(responseBody.data);

      // Verify updated preferences include both merged existing and new values
      const updatedPrefs = responseBody.data;
      assert.equal(updatedPrefs.soundEnabled, true); // preserved
      assert.equal(updatedPrefs.mapZoom, 15); // preserved
      assert.equal(updatedPrefs.haptics, true); // updated
      assert.equal(updatedPrefs.vibrationIntensity, 'high'); // newly added
      assert.equal(updatedPrefs.batterySaver, false); // newly added
      assert.equal(updatedPrefs.customNote, null); // null value supported

      // Verify database state for player 1
      const player1Updated = await playerRepo.findById('user-pref-1');
      assert.ok(player1Updated);
      assert.deepEqual(player1Updated.preferences, updatedPrefs);

      // Verify unrelated profile fields are strictly preserved
      assert.equal(player1Updated.totalPoints, 500);
      assert.equal(player1Updated.seasonPoints, 100);
      assert.equal(player1Updated.claimsCount, 5);
      assert.equal(player1Updated.currentStreakDays, 3);
      assert.equal(player1Updated.username, 'user_one');

      // Verify player 2 was completely unaffected
      const player2State = await playerRepo.findById('user-pref-2');
      assert.ok(player2State);
      assert.deepEqual(player2State.preferences, {
        soundEnabled: false,
        language: 'en',
      });
    });
  });
});
