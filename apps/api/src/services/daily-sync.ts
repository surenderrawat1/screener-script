import { getDailySyncStatus, runDailySync } from '@sv/data-adapters';

export async function fetchDailySyncStatus() {
  return getDailySyncStatus();
}

export async function runDailySyncJob(userId?: string, force = false, background = true) {
  if (background) {
    return runDailySync({ userId, force, trigger: 'manual', background: true });
  }
  return runDailySync({ userId, force, trigger: 'manual', background: false });
}
