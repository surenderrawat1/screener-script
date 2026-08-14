/**
 * Evaluate open journal positions and email EXIT alerts.
 * Usage: pnpm --filter @sv/data-adapters email:exit-alerts
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { initAppConfig } from '@sv/shared';
import { connectRedis } from '@sv/cache';
import { runOpenPositionExitAlerts } from '../src/open-position-exit-alerts.js';
import { isSignalEmailConfigured } from '../src/signal-alerts.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

await initAppConfig();
await connectRedis().catch(() => undefined);

if (!isSignalEmailConfigured()) {
  console.error('SMTP not configured — set SMTP_HOST + SMTP_FROM/SMTP_USER in .env');
  process.exit(1);
}

const result = await runOpenPositionExitAlerts({ force: true, skipWeekendGate: true });
console.error(JSON.stringify(result, null, 2));

if (!result.ok) {
  console.error(result.error ?? 'Exit alerts failed');
  process.exit(1);
}

if (result.swing_exits + result.intraday_exits === 0) {
  console.error('No EXIT signals on open journal positions right now — nothing to email.');
  process.exit(0);
}

if (result.emails_sent === 0) {
  console.error('Exit signals found but email not sent — check SIGNAL_ALERT_EMAIL_TO / dedupe.');
  process.exit(1);
}

console.error(
  `Sent exit alert email(s) · swing ${result.swing_exits} · intraday ${result.intraday_exits}`,
);
process.exit(0);
