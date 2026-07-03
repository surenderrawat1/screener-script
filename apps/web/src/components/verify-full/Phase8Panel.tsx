import VerifyFullField from './VerifyFullField';

const MIN_THESIS = 20;
const MIN_INVALIDATION = 10;

interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'yesno' | 'checkbox';
  required?: boolean;
  manualOnly?: boolean;
}

interface Phase8PanelProps {
  fields: FieldDef[];
  input: Record<string, string | number | boolean>;
  autoKeys: Set<string>;
  validationErrors?: string[];
  onChange: (key: string, value: string | boolean) => void;
}

function charHint(value: string | number | boolean | undefined, min: number): string {
  const len = String(value ?? '').trim().length;
  return len >= min ? `${len} chars ✓` : `${len}/${min} chars`;
}

export default function Phase8Panel({
  fields,
  input,
  autoKeys,
  validationErrors = [],
  onChange,
}: Phase8PanelProps) {
  return (
    <div className="verify-phase8">
      <p className="muted">
        Write thesis before any buy. Minimum {MIN_THESIS} characters per thesis field;{' '}
        {MIN_INVALIDATION} per invalidation. Review date enables watchlist auto-save on verify.
      </p>

      {validationErrors.length > 0 ? (
        <div className="verify-thesis-errors" role="alert">
          <strong>Complete thesis before investing:</strong>
          <ul>
            {validationErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="verify-form-grid-wide">
        {fields.map((field) => {
          const isThesis = ['thesis_business', 'thesis_financials', 'thesis_valuation'].includes(
            field.key,
          );
          const isInv = field.key === 'invalidation_1' || field.key === 'invalidation_2';
          const hint = isThesis
            ? charHint(input[field.key], MIN_THESIS)
            : isInv
              ? charHint(input[field.key], MIN_INVALIDATION)
              : undefined;

          return (
            <div key={field.key} className="verify-thesis-field">
              <VerifyFullField
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
                onChange={onChange}
              />
              {hint ? <span className="verify-char-hint muted">{hint}</span> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
