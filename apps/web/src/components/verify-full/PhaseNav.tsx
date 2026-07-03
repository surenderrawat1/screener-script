interface PhaseNavProps {
  phases: { id: number; shortTitle: string }[];
  active: number;
  onSelect: (id: number) => void;
}

export default function PhaseNav({ phases, active, onSelect }: PhaseNavProps) {
  return (
    <div className="verify-phase-nav" role="tablist" aria-label="Verification phases">
      {phases.map((phase) => (
        <button
          key={phase.id}
          type="button"
          role="tab"
          aria-selected={active === phase.id}
          className={`verify-phase-tab${active === phase.id ? ' active' : ''}`}
          onClick={() => onSelect(phase.id)}
        >
          {phase.shortTitle}
        </button>
      ))}
    </div>
  );
}
