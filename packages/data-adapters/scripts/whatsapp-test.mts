/**
 * WhatsApp smoke test — sends one HOT-tier style message.
 * Usage: pnpm --filter @sv/data-adapters whatsapp:test
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import {
  formatHotTierWhatsAppMessage,
  isWhatsAppConfigured,
  resolveWhatsAppProvider,
  sendWhatsAppText,
} from '../src/whatsapp-alerts.js';

loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

if (!isWhatsAppConfigured()) {
  console.error('WhatsApp not configured.');
  console.error('See docs/WHATSAPP-ALERTS.md — Twilio sandbox is the easiest path.');
  console.error('Need: WHATSAPP_TO + (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN or CallMeBot/Meta creds)');
  process.exit(1);
}

const provider = resolveWhatsAppProvider();
console.error(`Provider: ${provider}`);

const text = formatHotTierWhatsAppMessage({
  symbols: ['TEST'],
  regime: 'Smoke test',
  hits: [{ symbol: 'TEST', price: 100, decision_action: 'BUY', decision_score: 1 }],
});

const result = await sendWhatsAppText(`${text}\n\n(Script Screener WhatsApp connectivity test)`);
console.error(JSON.stringify(result, null, 2));

if (!result.sent) {
  console.error(`Not sent: ${result.reason ?? 'unknown'}`);
  process.exit(1);
}

console.error('WhatsApp test sent — check your phone.');
