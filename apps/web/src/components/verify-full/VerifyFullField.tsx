import AutoBadge from './AutoBadge';

type FieldType = 'text' | 'number' | 'date' | 'textarea' | 'select' | 'yesno' | 'checkbox';

interface FieldOption {
  value: string;
  label: string;
}

export interface VerifyFieldProps {
  fieldKey: string;
  label: string;
  type: FieldType;
  value: string | number | boolean;
  isAuto?: boolean;
  required?: boolean;
  placeholder?: string;
  options?: FieldOption[];
  onChange: (key: string, value: string | boolean) => void;
}

export default function VerifyFullField({
  fieldKey,
  label,
  type,
  value,
  isAuto,
  required,
  placeholder,
  options,
  onChange,
}: VerifyFieldProps) {
  const autoClass = isAuto ? ' auto-filled' : '';

  if (type === 'checkbox') {
    return (
      <label className={`verify-check-item${autoClass}`}>
        <input
          type="checkbox"
          checked={value === true || value === '1'}
          onChange={(e) => onChange(fieldKey, e.target.checked)}
        />
        <span>
          {label}
          {isAuto ? <AutoBadge /> : null}
        </span>
      </label>
    );
  }

  if (type === 'yesno') {
    const strVal = typeof value === 'boolean' ? (value ? 'yes' : '') : String(value);
    return (
      <label className={`verify-field${autoClass}`}>
        <span className="verify-field-label">
          {label}
          {isAuto ? <AutoBadge /> : null}
        </span>
        <div className="verify-yesno">
          {(options ?? [
            { value: '', label: '—' },
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]).map((opt) => (
            <label key={opt.value || 'blank'} className="verify-yesno-opt">
              <input
                type="radio"
                name={fieldKey}
                value={opt.value}
                checked={strVal === opt.value}
                onChange={() => onChange(fieldKey, opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </label>
    );
  }

  if (type === 'select') {
    return (
      <label className={`verify-field${autoClass}`}>
        <span className="verify-field-label">
          {label}
          {isAuto ? <AutoBadge /> : null}
        </span>
        <select
          value={typeof value === 'boolean' ? '' : String(value)}
          required={required}
          onChange={(e) => onChange(fieldKey, e.target.value)}
        >
          {(options ?? []).map((opt) => (
            <option key={opt.value || '_blank'} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (type === 'textarea') {
    return (
      <label className={`verify-field verify-field-wide${autoClass}`}>
        <span className="verify-field-label">
          {label}
          {isAuto ? <AutoBadge /> : null}
        </span>
        <textarea
          value={typeof value === 'boolean' ? '' : String(value)}
          required={required}
          placeholder={placeholder}
          rows={4}
          onChange={(e) => onChange(fieldKey, e.target.value)}
        />
      </label>
    );
  }

  const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
  return (
    <label className={`verify-field${autoClass}`}>
      <span className="verify-field-label">
        {label}
        {isAuto ? <AutoBadge /> : null}
      </span>
      <input
        type={inputType}
        value={typeof value === 'boolean' ? '' : String(value)}
        required={required}
        placeholder={placeholder}
        step={type === 'number' ? '0.01' : undefined}
        onChange={(e) => onChange(fieldKey, e.target.value)}
      />
    </label>
  );
}
