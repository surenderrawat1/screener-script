import type { VerifyFullInput } from './types.js';

const META_KEYS = new Set(['action', 'fetch_symbol']);

function stripMeta(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!META_KEYS.has(key)) out[key] = value;
  }
  return out;
}

function hasUserValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (value === false) return false;
  if (Array.isArray(value)) return false;
  return true;
}

/** Empty-form placeholders that must not override fetched auto values. */
function isSchemaPlaceholder(key: string, value: unknown): boolean {
  if (key === 'piotroski_score' && (value === -1 || value === '-1')) return true;
  return false;
}

export class FormState {
  private data: VerifyFullInput = {};
  private autoKeys = new Set<string>();

  mergeAuto(
    auto: VerifyFullInput,
    manual: VerifyFullInput,
    autoKeyList: string[],
  ): void {
    this.autoKeys = new Set(autoKeyList);
    this.data = { ...auto, auto_prefilled: '1' };

    for (const [key, value] of Object.entries(stripMeta(manual as Record<string, unknown>))) {
      if (!hasUserValue(value) || isSchemaPlaceholder(key, value)) continue;
      this.data[key] = value as string | number | boolean;
      this.autoKeys.delete(key);
    }
  }

  loadManual(manual: VerifyFullInput): void {
    this.data = this.toInput(stripMeta(manual as Record<string, unknown>));
    this.autoKeys.clear();
  }

  all(): VerifyFullInput {
    return { ...this.data };
  }

  get(key: string, defaultValue = ''): string {
    const v = this.data[key];
    if (v === undefined || v === null) return defaultValue;
    if (typeof v === 'boolean') return v ? '1' : '';
    return String(v);
  }

  isChecked(key: string): boolean {
    const v = this.data[key];
    return v === '1' || v === 1 || v === true;
  }

  isAuto(key: string): boolean {
    return this.autoKeys.has(key);
  }

  autoKeysList(): string[] {
    return [...this.autoKeys];
  }

  autoCount(): number {
    return this.autoKeys.size;
  }

  private toInput(raw: Record<string, unknown>): VerifyFullInput {
    const out: VerifyFullInput = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value;
      }
    }
    return out;
  }
}
