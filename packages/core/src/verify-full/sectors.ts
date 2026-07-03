import type { VerifyFieldOption, VerifySectorKey } from './types.js';

export const VERIFY_SECTOR_OPTIONS: VerifyFieldOption[] = [
  { value: 'general', label: 'General / Other' },
  { value: 'banking', label: 'Banking / NBFC' },
  { value: 'it', label: 'IT Services' },
  { value: 'defence', label: 'Defence / Aerospace' },
  { value: 'infra', label: 'Infrastructure / NBFC' },
  { value: 'fmcg', label: 'FMCG' },
  { value: 'pharma', label: 'Pharma & Healthcare' },
  { value: 'auto', label: 'Auto & Ancillary' },
  { value: 'metal', label: 'Metals & Mining' },
  { value: 'cement', label: 'Cement' },
  { value: 'telecom', label: 'Telecom' },
  { value: 'utility', label: 'Power / Utilities' },
  { value: 'reit', label: 'REIT / InvIT' },
];

export const OUTLOOK_OPTIONS: VerifyFieldOption[] = [
  { value: '', label: '— Select —' },
  { value: 'growing', label: 'Growing' },
  { value: 'stable', label: 'Stable' },
  { value: 'declining', label: 'Declining' },
];

export const TREND_OPTIONS: VerifyFieldOption[] = [
  { value: '', label: '— Select —' },
  { value: 'improving', label: 'Improving' },
  { value: 'stable', label: 'Stable' },
  { value: 'worsening', label: 'Worsening' },
];

export const YES_NO_OPTIONS: VerifyFieldOption[] = [
  { value: '', label: '—' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export const SECTOR_PANEL_KEYS: VerifySectorKey[] = [
  'banking',
  'it',
  'defence',
  'infra',
  'fmcg',
  'pharma',
  'auto',
  'metal',
  'cement',
  'telecom',
  'utility',
  'reit',
  'general',
];
