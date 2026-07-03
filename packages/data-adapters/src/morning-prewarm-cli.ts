import './load-env.js';
import { initAppConfig } from '@sv/shared';
import { connectRedis } from '@sv/cache';
import { warmMorningBriefing } from './morning-prewarm.js';

async function main() {
  await initAppConfig();
  await connectRedis().catch(() => undefined);
  const result = await warmMorningBriefing(true);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
