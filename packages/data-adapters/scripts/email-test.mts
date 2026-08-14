/**
 * SMTP smoke test — sends one High Conviction-style test email.
 * Usage (from repo root): pnpm --filter @sv/data-adapters email:test
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { isSignalEmailConfigured, sendTestSignalEmail } from '../src/signal-alerts.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

if (!isSignalEmailConfigured()) {
  console.error('SMTP not configured — set SMTP_HOST + SMTP_FROM/SMTP_USER in .env');
  process.exit(1);
}

const toArg = process.argv[2]?.trim();
const result = await sendTestSignalEmail(toArg);
console.error(JSON.stringify(result, null, 2));

if (!result.ok) {
  console.error(`Not sent: ${result.reason ?? 'unknown'}`);
  process.exit(1);
}

console.error(`Test email sent to ${result.to}`);
console.error('Check inbox (and spam). WhatsApp setup waits until email is confirmed.');
