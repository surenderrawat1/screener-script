interface EpsModePanelProps {
  input: Record<string, string | number | boolean>;
  onChange: (key: string, value: string | boolean) => void;
  labels?: {
    basis: string;
    consolidated: string;
    standalone: string;
    hint: string;
  };
}

export default function EpsModePanel({ input, onChange, labels }: EpsModePanelProps) {
  const mode = String(input.eps_mode ?? 'consolidated');
  const epsCons = input.eps_consolidated;
  const epsStand = input.eps_standalone;
  const hasDual =
    Number(epsCons ?? 0) > 0 || Number(epsStand ?? 0) > 0;

  const basis = labels?.basis ?? 'EPS basis (annual report)';
  const consolidated = labels?.consolidated ?? 'Consolidated';
  const standalone = labels?.standalone ?? 'Standalone';
  const hint = labels?.hint ?? 'Valuation recalculates on verify.';

  return (
    <fieldset className="verify-eps-mode">
      <legend>{basis}</legend>
      <div className="verify-yesno">
        {(['consolidated', 'standalone'] as const).map((val) => (
          <label key={val} className="verify-yesno-opt">
            <input
              type="radio"
              name="eps_mode"
              value={val}
              checked={mode === val}
              onChange={() => onChange('eps_mode', val)}
            />
            {val === 'consolidated' ? consolidated : standalone}
          </label>
        ))}
      </div>
      {hasDual ? (
        <p className="muted verify-eps-hint">
          Screener: {consolidated} ₹{epsCons || '—'} · {standalone} ₹{epsStand || '—'} — {hint}
        </p>
      ) : null}
    </fieldset>
  );
}
