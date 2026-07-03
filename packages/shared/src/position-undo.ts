/** Window after close during which a position can be reopened (undo close). */
export const UNDO_CLOSE_WINDOW_MS = 5 * 60 * 1000;

export function undoCloseMeta(closedAt: string | Date | null | undefined, nowMs = Date.now()) {
  if (!closedAt) {
    return { can_undo: false, undo_seconds_left: 0, undo_until: null as string | null };
  }
  const closedMs = closedAt instanceof Date ? closedAt.getTime() : Date.parse(closedAt);
  if (Number.isNaN(closedMs)) {
    return { can_undo: false, undo_seconds_left: 0, undo_until: null as string | null };
  }
  const remaining = UNDO_CLOSE_WINDOW_MS - (nowMs - closedMs);
  return {
    can_undo: remaining > 0,
    undo_seconds_left: remaining > 0 ? Math.ceil(remaining / 1000) : 0,
    undo_until: remaining > 0 ? new Date(closedMs + UNDO_CLOSE_WINDOW_MS).toISOString() : null,
  };
}
