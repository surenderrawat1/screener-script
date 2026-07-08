import { useEffect, useState } from 'react';

export function useRefreshCountdown(refreshedAt: string | undefined, intervalMs: number, enabled: boolean) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!enabled || !refreshedAt) {
      setSecondsLeft(0);
      return;
    }

    const refreshedAtMs = refreshedAt;

    function tick() {
      const elapsed = Date.now() - Date.parse(refreshedAtMs);
      const left = Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));
      setSecondsLeft(left);
    }

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [refreshedAt, intervalMs, enabled]);

  return secondsLeft;
}
