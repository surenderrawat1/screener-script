/**
 * NSE symbol → CFA sector key when Yahoo/Screener labels are vague.
 * Ported from tools/stock-verifier/data/nse_sector_hints.php
 */
export const NSE_SECTOR_HINTS: Record<string, string> = {
  MARUTI: 'auto',
  EICHERMOT: 'auto',
  HEROMOTOCO: 'auto',
  'BAJAJ-AUTO': 'auto',
  'M&M': 'auto',
  ONGC: 'oil_gas',
  OIL: 'oil_gas',
  BPCL: 'oil_gas',
  IOC: 'oil_gas',
  SBILIFE: 'insurance',
  HDFCLIFE: 'insurance',
  ICICIPRULI: 'insurance',
  LICI: 'insurance',
  BAJFINANCE: 'nbfc',
  SHRIRAMFIN: 'nbfc',
  CHOLAFIN: 'nbfc',
  'M&MFIN': 'nbfc',
  JSWSTEEL: 'metal',
  TATASTEEL: 'metal',
  HINDALCO: 'metal',
  VEDL: 'metal',
  COALINDIA: 'metal',
  ULTRACEMCO: 'cement',
  AMBUJACEM: 'cement',
  SHREECEM: 'cement',
  ACC: 'cement',
  BHARTIARTL: 'telecom',
  IDEA: 'telecom',
  NTPC: 'utility',
  POWERGRID: 'utility',
  TATAPOWER: 'utility',
  NHIT: 'reit',
  LT: 'infra',
  ADANIPORTS: 'infra',
  IRB: 'infra',
  TCS: 'it',
  INFY: 'it',
  WIPRO: 'it',
  HCLTECH: 'it',
  TECHM: 'it',
};

export function lookupSectorHint(symbol: string): string | undefined {
  const sym = symbol.trim().toUpperCase().replace(/\.(NS|BO)$/, '');
  return NSE_SECTOR_HINTS[sym];
}
