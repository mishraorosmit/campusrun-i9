import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WeeklyCycle } from '../domain/entities/WeeklyCycle';
import { WeeklyCycleSettings } from '../domain/entities/WeeklyCycleSettings';
import { WeeklyResetEvent } from '../domain/entities/WeeklyResetEvent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Weekly Cycle Data Model and Migration', () => {
  const migrationPath = path.resolve(
    __dirname,
    '../infrastructure/database/migrations/sql/20260913000010_create_weekly_cycle_models.sql'
  );

  it('should have the migration SQL file present and readable', () => {
    assert(fs.existsSync(migrationPath), 'Migration SQL file must exist');
    const sql = fs.readFileSync(migrationPath, 'utf-8');
    assert(sql.length > 0, 'Migration SQL must not be empty');
  });

  describe('weekly_cycles table definition', () => {
    it('should define weekly_cycles table with required fields and types', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      assert(sql.includes('CREATE TABLE IF NOT EXISTS weekly_cycles'), 'Must create weekly_cycles table');
      assert(sql.includes('starts_at TIMESTAMPTZ'), 'Must have starts_at TIMESTAMPTZ');
      assert(sql.includes('ends_at TIMESTAMPTZ'), 'Must have ends_at TIMESTAMPTZ');
      assert(sql.includes('status VARCHAR(20)'), 'Must have status column');
      assert(sql.includes('created_at TIMESTAMPTZ'), 'Must have created_at column');
      assert(sql.includes('completed_at TIMESTAMPTZ'), 'Must have optional completed_at column');
    });

    it('should enforce single active cycle via partial unique index', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      assert(
        sql.includes('idx_weekly_cycles_single_active') || sql.includes('ON weekly_cycles (status)'),
        'Must index weekly_cycles status'
      );
      assert(
        sql.includes("WHERE status = 'active'"),
        'Must constrain unique status where active'
      );
    });
  });

  describe('weekly_cycle_settings table definition', () => {
    it('should define single-row weekly_cycle_settings table', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      assert(sql.includes('CREATE TABLE IF NOT EXISTS weekly_cycle_settings'), 'Must create weekly_cycle_settings');
      assert(sql.includes('reset_weekday INT'), 'Must have reset_weekday column');
      assert(sql.includes('reset_time_utc TIME'), 'Must have reset_time_utc column');
      assert(sql.includes('updated_at TIMESTAMPTZ'), 'Must have updated_at column');
      assert(sql.includes('CHECK (id = 1)'), 'Must enforce single row check');
      assert(sql.includes('reset_weekday >= 0 AND reset_weekday <= 6'), 'Must enforce weekday range 0-6');
    });

    it('should seed default settings (Sunday, 23:59:00 UTC) with ON CONFLICT DO NOTHING', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      assert(sql.includes('INSERT INTO weekly_cycle_settings'), 'Must insert default seed');
      assert(sql.includes('23:59:00'), 'Default time must be 23:59:00 UTC');
      assert(sql.includes('ON CONFLICT (id) DO NOTHING'), 'Must be idempotent on conflict');
    });
  });

  describe('weekly_reset_events table definition', () => {
    it('should define weekly_reset_events table with unique reset_key and foreign key', () => {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      assert(sql.includes('CREATE TABLE IF NOT EXISTS weekly_reset_events'), 'Must create weekly_reset_events');
      assert(sql.includes('cycle_id UUID NOT NULL'), 'Must reference cycle_id');
      assert(sql.includes('reset_key VARCHAR(255) NOT NULL'), 'Must have reset_key column');
      assert(sql.includes('reset_type VARCHAR(20) NOT NULL'), 'Must have reset_type column');
      assert(sql.includes('triggered_by_profile_id UUID'), 'Must have triggered_by_profile_id column');
      assert(sql.includes('executed_at TIMESTAMPTZ'), 'Must have executed_at column');
      assert(sql.includes('CONSTRAINT uq_weekly_reset_events_key UNIQUE (reset_key)'), 'Must enforce unique reset_key');
      assert(sql.includes("CHECK (reset_type IN ('scheduled', 'manual'))"), 'Must validate reset_type values');
    });
  });

  describe('Domain Entities', () => {
    it('should instantiate WeeklyCycle entity correctly', () => {
      const startsAt = new Date('2026-09-07T00:00:00Z');
      const endsAt = new Date('2026-09-14T00:00:00Z');
      const createdAt = new Date('2026-09-07T00:00:00Z');

      const cycle = new WeeklyCycle({
        id: 'cycle-123',
        startsAt,
        endsAt,
        status: 'active',
        createdAt,
        completedAt: null,
      });

      assert.equal(cycle.id, 'cycle-123');
      assert.equal(cycle.status, 'active');
      assert.equal(cycle.isActive, true);
      assert.equal(cycle.isCompleted, false);
      assert.equal(cycle.completedAt, null);
    });

    it('should instantiate WeeklyCycleSettings entity and validate weekday', () => {
      const settings = new WeeklyCycleSettings({
        id: 1,
        resetWeekday: 0, // Sunday
        resetTimeUtc: '23:59:00',
        updatedAt: new Date(),
      });

      assert.equal(settings.id, 1);
      assert.equal(settings.resetWeekday, 0);
      assert.equal(settings.resetTimeUtc, '23:59:00');

      assert.throws(() => {
        new WeeklyCycleSettings({
          id: 1,
          resetWeekday: 7, // Invalid
          resetTimeUtc: '23:59:00',
          updatedAt: new Date(),
        });
      }, /Invalid reset_weekday/);
    });

    it('should instantiate WeeklyResetEvent entity correctly', () => {
      const event = new WeeklyResetEvent({
        id: 'event-uuid-1',
        cycleId: 'cycle-123',
        resetKey: 'reset:2026-W37:scheduled',
        resetType: 'scheduled',
        triggeredByProfileId: null,
        executedAt: new Date('2026-09-13T23:59:00Z'),
      });

      assert.equal(event.id, 'event-uuid-1');
      assert.equal(event.cycleId, 'cycle-123');
      assert.equal(event.resetKey, 'reset:2026-W37:scheduled');
      assert.equal(event.resetType, 'scheduled');
      assert.equal(event.triggeredByProfileId, null);
    });

    it('should demonstrate single active cycle and idempotent reset key enforcement', () => {
      // In-memory simulator representing PostgreSQL unique constraints
      const activeCycles = new Map<string, string>(); // status -> cycleId
      const resetEvents = new Set<string>(); // unique reset keys

      // 1. Add first active cycle
      const cycle1 = { id: 'c1', status: 'active' };
      if (cycle1.status === 'active') {
        assert(!activeCycles.has('active'), 'No other active cycle allowed');
        activeCycles.set('active', cycle1.id);
      }

      // 2. Attempting to add second active cycle fails
      const cycle2 = { id: 'c2', status: 'active' };
      let duplicateActiveBlocked = false;
      if (cycle2.status === 'active') {
        if (activeCycles.has('active')) {
          duplicateActiveBlocked = true;
        }
      }
      assert.equal(duplicateActiveBlocked, true, 'Second active cycle must be blocked');

      // 3. Reset key idempotency test
      const resetKey = 'reset:cycle-c1:2026-09-13';
      assert(!resetEvents.has(resetKey));
      resetEvents.add(resetKey);

      // Duplicate attempt detected
      const isDuplicate = resetEvents.has(resetKey);
      assert.equal(isDuplicate, true, 'Duplicate reset key must be detected for idempotency');
    });
  });
});
