/**
 * Master Verification Suite: Spawn Phase 01 to Rotation Phase 02
 * 
 * Sequentially executes all verification suites:
 * 1. Geospatial Contract Audit (IGeospatialService)
 * 2. Spawn Management Audit (Spawn Phases 01 - 04)
 * 3. Spawn Batch Engine Audit (Batch Phases 01 - 04)
 * 4. Rotation Service & Scheduler Audit (Rotation Phases 01 - 02)
 */

import { execSync } from 'child_process';

function runStep(title: string, cmd: string) {
  console.log(`\n================================================================`);
  console.log(`  RUNNING: ${title}`);
  console.log(`  COMMAND: ${cmd}`);
  console.log(`================================================================\n`);

  try {
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
    console.log(`\n>>> SUCCESS: ${title} PASSED.`);
  } catch (err) {
    console.error(`\n>>> FAILED: ${title} FAILED.`);
    process.exit(1);
  }
}

console.log('****************************************************************');
console.log('  PROJECT I9 — FULL SYSTEM AUDIT: SPAWN 01 TO ROTATION 02');
console.log('****************************************************************');

// Step 1: Type Checking
runStep('Step 1: TypeScript Strict Type Check', 'npx tsc --noEmit');

// Step 2: Geospatial Service Contract
runStep('Step 2: Geospatial Contract Audit', 'npx tsx test-geospatial-service-contract.ts');

// Step 3: Spawn Management (Phases 01 - 04)
runStep('Step 3: Spawn Management Audit (Phases 01 - 04)', 'npx tsx test-spawn-phases-audit.ts');

// Step 4: Batch Engine (Phases 01 - 04)
runStep('Step 4: Spawn-Batch Engine Audit (Phases 01 - 04)', 'npx tsx test-batch-phases-audit.ts');

// Step 5: Rotation Service & Scheduler (Phases 01 - 02)
runStep('Step 5: Rotation Service & Scheduler Audit (Phases 01 - 02)', 'npx tsx test-rotation-phases-audit.ts');

// Step 6: Admin Manual Force Rotate (Rotation Phase 03)
runStep('Step 6: Rotation Phase 03 Audit (Admin Force Rotate)', 'npx tsx test-rotation-phase-03.ts');

// Step 7: Complete Rotation System Audit (Rotation Phase 04)
runStep('Step 7: Rotation Phase 04 Final Audit (Full System Audit)', 'npx tsx test-rotation-final-audit.ts');

// Step 8: Claim Validation & Endpoint Audit (Claim Phase 01)
runStep('Step 8: Claim Phase 01 Audit (Claim Validation & Endpoint)', 'npx tsx test-claim-phase-01.ts');

// Step 9: Authoritative Claim Transaction & Event Emission (Claim Phases 02 & 03)
runStep('Step 9: Claim Phase 03 Audit (Authoritative Transaction & Event Emission)', 'npx tsx test-claim-phase-03.ts');

// Step 10: Complete Security & Anti-Cheat Final Audit (Claim Phase 04)
runStep('Step 10: Claim Phase 04 Final Security & Anti-Cheat Audit', 'npx tsx test-claim-final-audit.ts');

console.log('\n****************************************************************');
console.log('  🎉 COMPLETE SYSTEM AUDIT: ALL PHASES (SPAWN 01 -> CLAIM 04) 100% PASSED!');
console.log('****************************************************************\n');
