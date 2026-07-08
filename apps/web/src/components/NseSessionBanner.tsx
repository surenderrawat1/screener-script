export interface NseSessionInfo {
  phase: string;
  label: string;
  message: string;
  live_quotes: boolean;
  ist_time: string;
  ist_date: string;
}

function sessionClass(phase: string): string {
  if (phase === 'open') return 'morning-session-open';
  if (phase === 'weekend' || phase === 'post') return 'morning-session-closed';
  return 'morning-session-pre';
}

export function NseSessionBanner({ session }: { session: NseSessionInfo }) {
  return (
    <div className={`card morning-session ${sessionClass(session.phase)}`}>
      <div className="morning-session-row">
        <div>
          <strong>NSE · {session.label}</strong>
          <span className="muted" style={{ marginLeft: '0.75rem' }}>
            {session.ist_date} · {session.ist_time} IST
          </span>
        </div>
        {session.live_quotes && <span className="badge badge-buy">Live quotes</span>}
      </div>
      <p className="muted" style={{ margin: '0.5rem 0 0' }}>
        {session.message}
      </p>
    </div>
  );
}
