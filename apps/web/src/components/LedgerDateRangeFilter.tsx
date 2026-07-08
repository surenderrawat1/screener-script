export type LedgerDatePreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'this_month'
  | 'last_month'
  | 'custom';

export interface LedgerDateRange {
  from: string;
  to: string;
}

const PRESETS: Array<{ id: LedgerDatePreset; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'this_week', label: 'This week' },
  { id: 'last_week', label: 'Last week' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
];

function dateOnly(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfWeekMonday(d: Date): Date {
  const next = new Date(d);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function rangeForPreset(
  preset: LedgerDatePreset,
  customFrom = dateOnly(new Date()),
  customTo = customFrom,
): LedgerDateRange {
  const today = new Date();
  if (preset === 'custom') {
    return { from: customFrom || dateOnly(today), to: customTo || customFrom || dateOnly(today) };
  }
  if (preset === 'yesterday') {
    const y = addDays(today, -1);
    return { from: dateOnly(y), to: dateOnly(y) };
  }
  if (preset === 'this_week') {
    return { from: dateOnly(startOfWeekMonday(today)), to: dateOnly(today) };
  }
  if (preset === 'last_week') {
    const thisWeek = startOfWeekMonday(today);
    const lastWeekStart = addDays(thisWeek, -7);
    return { from: dateOnly(lastWeekStart), to: dateOnly(addDays(thisWeek, -1)) };
  }
  if (preset === 'this_month') {
    return { from: dateOnly(startOfMonth(today)), to: dateOnly(today) };
  }
  if (preset === 'last_month') {
    const firstThisMonth = startOfMonth(today);
    const firstLastMonth = new Date(firstThisMonth.getFullYear(), firstThisMonth.getMonth() - 1, 1);
    return { from: dateOnly(firstLastMonth), to: dateOnly(addDays(firstThisMonth, -1)) };
  }
  return { from: dateOnly(today), to: dateOnly(today) };
}

interface Props {
  preset: LedgerDatePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (preset: LedgerDatePreset) => void;
  onCustomFromChange: (date: string) => void;
  onCustomToChange: (date: string) => void;
}

export function LedgerDateRangeFilter({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onCustomFromChange,
  onCustomToChange,
}: Props) {
  const range = rangeForPreset(preset, customFrom, customTo);
  return (
    <div className="ledger-date-filter">
      <span>Date:</span>
      <div className="segmented ledger-date-tabs">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={preset === p.id ? 'btn' : 'btn btn-secondary'}
            onClick={() => onPresetChange(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {preset === 'custom' ? (
        <div className="ledger-custom-range">
          <label>
            From
            <input type="date" value={customFrom} onChange={(e) => onCustomFromChange(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customTo} onChange={(e) => onCustomToChange(e.target.value)} />
          </label>
        </div>
      ) : null}
      <span className="segmented-meta">
        {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
      </span>
    </div>
  );
}
