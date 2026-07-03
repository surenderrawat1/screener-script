import VerifyFullField from './VerifyFullField';

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'yesno' | 'checkbox';
  section?: string;
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  manualOnly?: boolean;
  showWhen?: { field: string; equals: string | boolean };
}

interface Phase7PanelProps {
  fields: FieldDef[];
  input: Record<string, string | number | boolean>;
  autoKeys: Set<string>;
  onChange: (key: string, value: string | boolean) => void;
}

function fieldVisible(field: FieldDef, input: Record<string, string | number | boolean>): boolean {
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

export default function Phase7Panel({ fields, input, autoKeys, onChange }: Phase7PanelProps) {
  const holding =
    input.already_holding === true || input.already_holding === '1' || input.already_holding === 1;

  const portfolioFields = fields.filter(
    (f) => !f.section?.includes('Exit') && !f.section?.includes('Red Flag') && fieldVisible(f, input),
  );
  const exitFields = fields.filter((f) => f.section === 'Exit Triggers' && fieldVisible(f, input));
  const redFlagFields = fields.filter(
    (f) => f.section === 'Red Flag Scan' && fieldVisible(f, input),
  );

  const portfolioGroups = groupFields(portfolioFields);

  const exitActive = exitFields.some(
    (f) => input[f.key] === true || input[f.key] === '1' || input[f.key] === 1,
  );

  return (
    <div className="verify-phase7">
      <div className="verify-holding-block card-inner">
        <h4>Holding status</h4>
        <p className="muted">
          If you already own this stock, enable holding to surface exit triggers (E.1–E.5).
        </p>
        <VerifyFullField
          fieldKey="already_holding"
          label="Already holding this stock?"
          type="checkbox"
          value={holding}
          isAuto={autoKeys.has('already_holding')}
          onChange={onChange}
        />
        {holding ? (
          <VerifyFullField
            fieldKey="entry_price"
            label="Entry price (₹)"
            type="number"
            value={input.entry_price ?? ''}
            isAuto={autoKeys.has('entry_price')}
            onChange={onChange}
          />
        ) : null}
      </div>

      {[...portfolioGroups.entries()].map(([section, sectionFields]) => (
        <div key={section || 'portfolio'} className="verify-form-section">
          {section ? <h4>{section}</h4> : null}
          <div className="verify-form-grid">
            {sectionFields
              .filter((f) => f.key !== 'already_holding' && f.key !== 'entry_price')
              .map((field) => (
                <VerifyFullField
                  key={field.key}
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

      {holding ? (
        <div className={`verify-exit-block${exitActive ? ' verify-exit-active' : ''}`}>
          <h4>Exit triggers</h4>
          <p className="muted">Exit if ANY trigger is true — engine marks critical fail on Phase 7.</p>
          {exitActive ? (
            <p className="verify-exit-warning">⚠ One or more exit triggers active — consider EXIT.</p>
          ) : null}
          <div className="verify-form-grid-wide">
            {exitFields.map((field) => (
              <VerifyFullField
                key={field.key}
                fieldKey={field.key}
                label={field.label}
                type={field.type}
                value={input[field.key] === true || input[field.key] === '1'}
                isAuto={autoKeys.has(field.key)}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      ) : null}

      {redFlagFields.length > 0 ? (
        <div className="verify-form-section">
          <h4>Red flag scan (manual)</h4>
          <div className="verify-form-grid-wide">
            {redFlagFields.map((field) => (
              <VerifyFullField
                key={field.key}
                fieldKey={field.key}
                label={field.label}
                type={field.type}
                value={input[field.key] === true || input[field.key] === '1'}
                isAuto={autoKeys.has(field.key)}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
