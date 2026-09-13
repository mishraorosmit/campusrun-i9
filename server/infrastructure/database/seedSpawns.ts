import { DatabasePool, dbPool } from './pool';
import { validateEnvironment } from '../../config/env';
import { PostgresSpawnRepository } from '../repositories/postgres/PostgresSpawnRepository';
import { PostgresGeospatialService } from '../geo/PostgresGeospatialService';
import { SpawnPoint } from '../../domain/entities/SpawnPoint';
import { Coordinates } from '../../domain/types';

async function seed() {
  const { config } = validateEnvironment();
  const pool = dbPool;
  pool.initialize({
    connectionString: config!.DATABASE_URL,
    max: 5,
    min: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    statementTimeoutMillis: 5000,
  });

  const spawnRepo = new PostgresSpawnRepository(pool);
  const geoService = new PostgresGeospatialService(pool);

  // 36 grid points across Stanford campus ensuring >= 60m separation
  const lats = [37.4320, 37.4305, 37.4290, 37.4275, 37.4260, 37.4245];
  const lngs = [-122.1750, -122.1735, -122.1720, -122.1705, -122.1690, -122.1675];
  
  const zoneIds = [
    'zone-north-hostels',
    'zone-academic-core',
    'zone-central-blocks',
    'zone-sports-arena',
    'zone-south-hostels',
  ];

  let count = 0;
  for (let i = 0; i < lats.length; i++) {
    for (let j = 0; j < lngs.length; j++) {
      count++;
      const code = `SPW-CANON-${count.toString().padStart(2, '0')}`;
      const existing = await spawnRepo.findByCode(code);
      if (existing) continue;

      const coord: Coordinates = { lat: lats[i], lng: lngs[j] };
      const svgCoord = geoService.gpsToSvg(coord);
      const zoneId = zoneIds[count % zoneIds.length];

      const spawn = SpawnPoint.create({
        code,
        title: `Campus Node ${count}`,
        description: `Authoritative campus spawn node located in ${zoneId}.`,
        zoneId,
        coordinates: coord,
        svgCoordinates: svgCoord,
        points: (count % 3 + 1) * 100,
        enabled: true,
        claimRadiusMeters: 25,
      });

      await spawnRepo.create(spawn);
      console.log(`Seeded spawn: ${code} (${spawn.title})`);
    }
  }

  console.log('Seeding complete. Checking active batches...');

  // Ensure there is an active weekly cycle
  const activeCycle = await pool.query(`SELECT id FROM weekly_cycles WHERE status = 'active' LIMIT 1;`);
  if (activeCycle.rowCount === 0) {
    await pool.query(`
      INSERT INTO weekly_cycles (id, cycle_number, starts_at, ends_at, status)
      VALUES (gen_random_uuid(), 1, NOW(), NOW() + INTERVAL '7 days', 'active');
    `);
    console.log('Created active weekly cycle.');
  }

  await pool.shutdown();
  console.log('Done.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
