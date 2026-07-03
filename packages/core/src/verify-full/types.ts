export type VerifyFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'textarea'
  | 'select'
  | 'yesno'
  | 'checkbox';

export type VerifySectorKey =
  | 'banking'
  | 'it'
  | 'defence'
  | 'infra'
  | 'fmcg'
  | 'pharma'
  | 'auto'
  | 'metal'
  | 'cement'
  | 'telecom'
  | 'utility'
  | 'reit'
  | 'general';

export interface VerifyFieldOption {
  value: string;
  label: string;
}

export interface VerifyFieldDef {
  key: string;
  label: string;
  type: VerifyFieldType;
  section?: string;
  required?: boolean;
  placeholder?: string;
  options?: VerifyFieldOption[];
  /** Phase 6 sector panel — shown when Phase 0 sector matches */
  sectorPanel?: VerifySectorKey;
  /** Never tagged AUTO (personal / attestation gates) */
  manualOnly?: boolean;
  hidden?: boolean;
  /** Show field only when another field matches */
  showWhen?: { field: string; equals: string | boolean };
  hint?: string;
}

export interface VerifyPhaseDef {
  id: number;
  title: string;
  shortTitle: string;
  description: string;
  manualNote?: string;
  fields: VerifyFieldDef[];
}

export type VerifyFullInput = Record<string, string | number | boolean>;

export interface VerifyFullPrefill {
  symbol: string;
  input: VerifyFullInput;
  auto_keys: string[];
  phases: VerifyPhaseDef[];
  sectors: VerifyFieldOption[];
}
