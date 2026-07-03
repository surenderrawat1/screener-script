interface SectorOption {
  value: string;
  label: string;
}

interface VerifySectorPanelProps {
  sectors: SectorOption[];
  activeSector: string;
  onGoPhase0?: () => void;
}

export default function VerifySectorPanel({
  sectors,
  activeSector,
  onGoPhase0,
}: VerifySectorPanelProps) {
  const active = sectors.find((s) => s.value === activeSector);

  return (
    <div className="verify-sector-panel">
      <div className="verify-sector-header">
        <h4>Sector block</h4>
        <p className="muted">
          Active: <strong>{active?.label ?? activeSector}</strong> — set in Phase 0.
          {onGoPhase0 ? (
            <>
              {' '}
              <button type="button" className="btn-link" onClick={onGoPhase0}>
                Change sector →
              </button>
            </>
          ) : null}
        </p>
      </div>
      <div className="verify-sector-chips" role="list" aria-label="Sector panels">
        {sectors.map((s) => (
          <span
            key={s.value}
            role="listitem"
            className={`verify-sector-chip${s.value === activeSector ? ' active' : ''}`}
            title={s.value === activeSector ? 'Active panel' : 'Change sector in Phase 0'}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
