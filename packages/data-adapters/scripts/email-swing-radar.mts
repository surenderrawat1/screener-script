/**
 * Send swing High Conviction radar emails from the current Auto snapshot.
 * Usage: pnpm run email:swing-radar
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { getSwingAutoSnapshotDurable } from '../src/auto-swing-scan.js';
import { dispatchSwingRadarEmails } from '../src/swing-radar-alerts.js';
import { isSignalEmailConfigured } from '../src/signal-alerts.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

if (!isSignalEmailConfigured()) {
  console.error('SMTP not configured — set SMTP_HOST + SMTP_FROM/SMTP_USER in .env');
  process.exit(1);
}

const snapshot = await getSwingAutoSnapshotDurable();
if (!snapshot) {
  console.error('No Swing Auto snapshot — wait for a scan or force-refresh Swing Auto in the UI.');
  process.exit(1);
}

const hc = Array.isArray(snapshot.tiers?.high_conviction)
  ? snapshot.tiers.high_conviction.length
  : 0;
console.error(`Snapshot ${snapshot.saved_at} · High Conviction hits: ${hc}`);

const result = await dispatchSwingRadarEmails(snapshot);
console.error(JSON.stringify(result, null, 2));
if (!result.sent && result.signals === 0) {
  console.error('Nothing to send — no High Conviction names right now.');
} else if (!result.sent) {
  console.error(`Not sent: ${result.reason ?? 'deduped or SMTP failed'}`);
  process.exit(1);
} else {
  console.error(`Sent ${result.signals} swing signal(s) to SIGNAL_ALERT_EMAIL_TO / armed users.`);
}
