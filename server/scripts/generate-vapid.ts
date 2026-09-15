import webpush from 'web-push';

export interface VapidKeysResult {
  publicKey: string;
  privateKey: string;
}

/**
 * Generates a standard Web Push VAPID key pair using web-push.
 */
export function generateVapidKeys(): VapidKeysResult {
  const vapidKeys = webpush.generateVAPIDKeys();
  return {
    publicKey: vapidKeys.publicKey,
    privateKey: vapidKeys.privateKey,
  };
}

/**
 * CLI execution entrypoint
 */
export function runVapidGenerationCLI(): VapidKeysResult {
  const keys = generateVapidKeys();

  console.log('\n============================================================');
  console.log(' Campus Run - VAPID Key Generation');
  console.log('============================================================\n');
  console.log('Copy and paste the following into your .env file:\n');
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
  console.log(`VAPID_SUBJECT=mailto:admin@campusrun.app\n`);
  console.log('============================================================\n');

  return keys;
}

// Auto-run if executed directly as main script
const isMainModule = process.argv[1]?.replace(/\\/g, '/').endsWith('generate-vapid.ts');
if (isMainModule) {
  runVapidGenerationCLI();
}
