import VerifyFullField from './VerifyFullField';
import Phase7Panel from './Phase7Panel';
import Phase8Panel from './Phase8Panel';
import VerifySectorPanel from './VerifySectorPanel';
import EpsModePanel from './EpsModePanel';

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'yesno' | 'checkbox';
  section?: string;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  sectorPanel?: string;
  manualOnly?: boolean;
  hidden?: boolean;
  showWhen?: { field: string; equals: string | boolean };
  hint?: string;
}

interface PhaseDef {
  id: number;
  title: string;
  description: string;
  manualNote?: string;
  fields: FieldDef[];
}

interface PhasePanelProps {
  phase: PhaseDef;
  input: Record<string, string | number | boolean>;
  autoKeys: Set<string>;
  sector: string;
  sectors: { value: string; label: string }[];
  thesisErrors?: string[];
  epsLabels?: { basis: string; consolidated: string; standalone: string; hint: string };
  onChange: (key: string, value: string | boolean) => void;
  onGoPhase0?: () => void;
}

function fieldVisible(field: FieldDef, input: Record<string, string | number | boolean>): boolean {
  if (field.hidden) return false;
  if (field.showWhen) {
    const current = input[field.showWhen.field];
    const target = field.showWhen.equals;
    if (typeof target === 'boolean') {
      const checked = current === true || current === '1' || current === 1;
      return checked === target;
    }
    return String(current ?? '') === target;
  }
  return true;
}

function groupFields(fields: FieldDef[]): Map<string, FieldDef[]> {
  const groups = new Map<string, FieldDef[]>();
  for (const field of fields) {
    const section = field.section ?? '';
    const list = groups.get(section) ?? [];
    list.push(field);
    groups.set(section, list);
  }
  return groups;
}

export default function PhasePanel({
  phase,
  input,
  autoKeys,
  sector,
  sectors,
  thesisErrors,
  epsLabels,
  onChange,
  onGoPhase0,
}: PhasePanelProps) {
  if (phase.id === 7) {
    return (
      <div className="verify-phase-panel">
        <h3>{phase.title}</h3>
        <p className="muted verify-phase-desc">{phase.description}</p>
        {phase.manualNote ? <p className="verify-manual-note">{phase.manualNote}</p> : null}
        <Phase7Panel fields={phase.fields} input={input} autoKeys={autoKeys} onChange={onChange} />
      </div>
    );
  }

  if (phase.id === 8) {
    return (
      <div className="verify-phase-panel">
        <h3>{phase.title}</h3>
        <p className="muted verify-phase-desc">{phase.description}</p>
        <Phase8Panel
          fields={phase.fields}
          input={input}
          autoKeys={autoKeys}
          validationErrors={thesisErrors}
          onChange={onChange}
        />
      </div>
    );
  }

  const visibleFields =
    phase.id === 6
      ? phase.fields.filter((f) => !f.sectorPanel || f.sectorPanel === sector)
      : phase.id === 2
        ? phase.fields.filter((f) => f.key !== 'eps_mode' && fieldVisible(f, input))
        : phase.fields.filter((f) => fieldVisible(f, input));

  const groups = groupFields(visibleFields);

  return (
    <div className="verify-phase-panel">
      <h3>{phase.title}</h3>
      <p className="muted verify-phase-desc">{phase.description}</p>
      {phase.manualNote ? <p className="verify-manual-note">{phase.manualNote}</p> : null}

      {phase.id === 5 && String(input.z_score_source ?? '') === 'unreliable' ? (
        <p className="verify-manual-note verify-warning">
          Altman Z proxy is out of range for this stock — review the component fields below or enter Z
          from the annual report. Gate 5.2 stays pending until Z is reliable.
        </p>
      ) : null}

      {phase.id === 6 ? (
        <VerifySectorPanel sectors={sectors} activeSector={sector} onGoPhase0={onGoPhase0} />
      ) : null}

      {phase.id === 2 ? (
        <EpsModePanel input={input} onChange={onChange} labels={epsLabels} />
      ) : null}

      {[...groups.entries()].map(([section, fields]) => (
        <div key={section || 'main'} className="verify-form-section">
          {section ? <h4>{section}</h4> : null}
          <div className={phase.id === 8 ? 'verify-form-grid-wide' : 'verify-form-grid'}>
            {fields.map((field) => (
              <VerifyFullField
                key={`${phase.id}-${field.key}-${field.sectorPanel ?? ''}`}
                fieldKey={field.key}
                label={field.label}
                type={field.type}
                value={
                  input[field.key] !== undefined
                    ? input[field.key]
                    : field.type === 'checkbox'
                      ? false
                      : ''
                }
                isAuto={autoKeys.has(field.key)}
                required={field.required}
                placeholder={field.placeholder}
                options={field.options}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
