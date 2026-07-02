import { getDailySyncStatus, runDailySync } from '@sv/data-adapters';

export async function fetchDailySyncStatus() {
  return getDailySyncStatus();
}

export async function runDailySyncJob(userId?: string, force = false) {
  return runDailySync({ userId, force, trigger: 'manual' });
}
