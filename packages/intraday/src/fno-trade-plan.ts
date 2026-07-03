import {
  atmStrike,
  fnoSpecForInstrument,
  futuresSymbolLabel,
  nextExpiry,
  optionSymbolLabel,
  type FnoExpiryInfo,
  type FnoUnderlyingSpec,
} from './fno-specs.js';

const PREMIUM_STOP_PCT = 35;
const PREMIUM_TARGET_MULT = [0.5, 1.0, 1.5]; // vs risk premium
const DELTA_ATM_EST = 0.5;

export function buildFnoTradePlans(
  instrumentId: string,
  spotPlan: Record<string, unknown> | null,
  analysis: Record<string, unknown>,
  mtf: Record<string, unknown> | null | undefined,
) {
  const spec = fnoSpecForInstrument(instrumentId);
  const spot = Number(analysis.price ?? 0);

  if (!spec) {
    return {
      ok: false,
      message: 'F&O plans are available for Nifty, Bank Nifty, and select F&O stocks only.',
      underlying: String(analysis.symbol ?? instrumentId),
      expiry: null,
      futures: null,
      options: null,
      risk_notes: ['Use spot/equity tab for stocks without F&O specs in this build.'],
    };
  }

  const expiry = nextExpiry(spec);
  const confidence = Number(analysis.confidence ?? 0);
  const mtfDeploy = Number(mtf?.deploy_pct ?? 50);

  if (!spotPlan?.ok || spot <= 0) {
    return {
      ok: false,
      message: String(spotPlan?.message ?? 'No spot trade plan — F&O stand aside.'),
      underlying: spec.label,
      expiry,
      futures: null,
      options: null,
      risk_notes: defaultRiskNotes(spec, expiry),
    };
  }

  const isLong = spotPlan.bias === 'long';
  const entry = Number((spotPlan.entry as Record<string, unknown>)?.price ?? spot);
  const stop = Number((spotPlan.stop_loss as Record<string, unknown>)?.price ?? 0);
  const riskPts = Math.abs(entry - stop);
  const exits = (spotPlan.exits as Array<Record<string, unknown>>) ?? [];

  if (riskPts <= 0) {
    return {
      ok: false,
      message: 'Invalid stop distance for F&O sizing.',
      underlying: spec.label,
      expiry,
      futures: null,
      options: null,
      risk_notes: defaultRiskNotes(spec, expiry),
    };
  }

  const futures = buildFuturesPlan(spec, spotPlan, isLong, entry, stop, riskPts, exits, expiry, confidence, mtfDeploy);
  const options = buildOptionsPlan(spec, spotPlan, isLong, entry, stop, riskPts, exits, spot, expiry, confidence, mtfDeploy);

  return {
    ok: true,
    message: null,
    underlying: spec.label,
    instrument_id: instrumentId,
    expiry,
    bias: isLong ? 'long' : 'short',
    bias_label: isLong ? 'Bullish F&O' : 'Bearish F&O',
    spot_reference: Math.round(spot * 100) / 100,
    risk_pts: Math.round(riskPts * 100) / 100,
    futures,
    options,
    risk_notes: [
      ...defaultRiskNotes(spec, expiry),
      spec.kind === 'stock'
        ? 'Stock F&O P&L uses lot size × price move (futures) or premium (options).'
        : 'Index F&O P&L uses lot size × index points (futures) or premium (options).',
      'Margin and premiums are estimates — check broker terminal before entry.',
      expiry.is_today ? 'Expiry day: avoid new option buys after 14:00 IST unless scalping.' : null,
    ].filter(Boolean) as string[],
  };
}

function buildFuturesPlan(
  spec: FnoUnderlyingSpec,
  spotPlan: Record<string, unknown>,
  isLong: boolean,
  entry: number,
  stop: number,
  riskPts: number,
  exits: Array<Record<string, unknown>>,
  expiry: ReturnType<typeof nextExpiry>,
  confidence: number,
  mtfDeploy: number,
) {
  const lot = spec.lot_size;
  const notional = Math.round(entry * lot);
  const marginEst = Math.round((notional * spec.margin_pct_est) / 100);
  const riskInr = Math.round(riskPts * lot);
  const targets = exits.map((ex, i) => {
    const px = Number(ex.price ?? 0);
    const pts = Math.abs(px - entry);
    return {
      tier: String(ex.tier ?? `T${i + 1}`),
      index_level: px,
      points: Math.round(pts * 100) / 100,
      pnl_inr_est: Math.round(pts * lot),
      rr: ex.rr ?? null,
    };
  });

  const lotsSuggested = suggestLots(mtfDeploy, confidence, marginEst);

  const ptsLabel = spec.kind === 'stock' ? '₹' : 'pts';
  const moveLabel = spec.kind === 'stock' ? 'price' : 'index';

  return {
    ok: true,
    symbol_label: futuresSymbolLabel(spec, expiry),
    side: isLong ? 'BUY' : 'SELL',
    side_label: isLong ? 'Buy futures (long)' : 'Sell futures (short)',
    lot_size: lot,
    lots_suggested: lotsSuggested,
    quantity: lot * lotsSuggested,
    entry_index: Math.round(entry * 100) / 100,
    stop_index: Math.round(stop * 100) / 100,
    risk_pts: Math.round(riskPts * 100) / 100,
    risk_inr_per_lot: riskInr,
    risk_inr_total: riskInr * lotsSuggested,
    notional_inr: notional,
    margin_inr_est: marginEst,
    margin_inr_total_est: marginEst * lotsSuggested,
    targets,
    trail: spotPlan.trail ?? null,
    time_stop_ist: spotPlan.time_stop_ist ?? '15:15',
    trigger: spotPlan.trigger ?? null,
    notes: [
      `1 lot = ${lot} units · ₹${riskInr.toLocaleString('en-IN')} risk per lot for ${Math.round(riskPts)} ${ptsLabel}`,
      spec.kind === 'stock'
        ? 'Stock futures track the equity; basis vs cash is usually small.'
        : 'Futures track spot; small basis vs index LTP is normal.',
      isLong
        ? `Long fut: profit when ${moveLabel} rises above entry.`
        : `Short fut: profit when ${moveLabel} falls below entry.`,
    ],
  };
}

function buildOptionsPlan(
  spec: FnoUnderlyingSpec,
  spotPlan: Record<string, unknown>,
  isLong: boolean,
  entry: number,
  stop: number,
  riskPts: number,
  exits: Array<Record<string, unknown>>,
  spot: number,
  expiry: ReturnType<typeof nextExpiry>,
  confidence: number,
  mtfDeploy: number,
) {
  const optionType: 'CE' | 'PE' = isLong ? 'CE' : 'PE';
  const atm = atmStrike(spot, spec.strike_step);
  const otmStrike = isLong ? atm + spec.strike_step : atm - spec.strike_step;

  const useAtm = confidence >= 55 && mtfDeploy >= 60;
  const strike = useAtm ? atm : otmStrike;
  const strikeStyle = useAtm ? 'ATM' : '1-strike OTM';

  const premiumEst = estimatePremium(spot, strike, riskPts, optionType);
  const premiumStop = Math.round(premiumEst * (1 - PREMIUM_STOP_PCT / 100) * 100) / 100;
  const lot = spec.lot_size;
  const riskInrPerLot = Math.round((premiumEst - premiumStop) * lot);
  const lotsSuggested = suggestLots(mtfDeploy, confidence, premiumEst * lot, true);

  const targets = PREMIUM_TARGET_MULT.map((mult, i) => {
    const spotTarget = exits[i] ? Number(exits[i].price ?? 0) : 0;
    const spotMove = spotTarget > 0 ? Math.abs(spotTarget - entry) : riskPts * (i + 1);
    const premiumGain = Math.round(spotMove * DELTA_ATM_EST * mult * 100) / 100;
    const exitPremium = Math.round((premiumEst + premiumGain) * 100) / 100;
    return {
      tier: `T${i + 1}`,
      index_level: spotTarget > 0 ? spotTarget : null,
      premium_target_est: exitPremium,
      book_pct: [40, 40, 20][i],
      pnl_inr_est: Math.round((exitPremium - premiumEst) * lot * lotsSuggested),
    };
  });

  return {
    ok: true,
    strategy: 'buy_directional',
    strategy_label: isLong ? 'Buy Call (CE)' : 'Buy Put (PE)',
    option_type: optionType,
    strike,
    strike_style: strikeStyle,
    atm_strike: atm,
    symbol_label: optionSymbolLabel(spec, strike, optionType, expiry),
    lot_size: lot,
    lots_suggested: lotsSuggested,
    quantity: lot * lotsSuggested,
    premium_entry_est: premiumEst,
    premium_stop_est: premiumStop,
    premium_stop_pct: PREMIUM_STOP_PCT,
    risk_inr_per_lot: riskInrPerLot,
    risk_inr_total: riskInrPerLot * lotsSuggested,
    spot_entry_ref: Math.round(entry * 100) / 100,
    spot_stop_ref: Math.round(stop * 100) / 100,
    spot_risk_pts: Math.round(riskPts * 100) / 100,
    targets,
    time_stop_ist: spotPlan.time_stop_ist ?? '15:15',
    trigger: spotPlan.trigger ?? null,
    notes: [
      `${strikeStyle} ${optionType} for ${isLong ? 'bullish' : 'bearish'} intraday bias.`,
      `Premium is estimated (~${Math.round(premiumEst)} pts) — use live chain before order.`,
      `Stop option premium at ~${PREMIUM_STOP_PCT}% loss or if spot hits ${Math.round(stop)}.`,
      'Theta accelerates after 14:00 IST on expiry week — prefer morning entries.',
      'Avoid holding OTM options into last hour unless scalping.',
    ],
    greeks_hint: {
      delta_est: useAtm ? DELTA_ATM_EST : 0.4,
      theta_risk: expiry.is_today ? 'high' : 'moderate',
      iv_note: 'Rising IV helps long options; falling IV hurts even if direction is right.',
    },
  };
}

/** Rough ATM premium from ATR/risk (educational; not market data). */
function estimatePremium(spot: number, strike: number, riskPts: number, type: 'CE' | 'PE'): number {
  const moneyness = Math.abs(spot - strike);
  const intrinsic = type === 'CE' ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  const timeValue = Math.max(riskPts * 0.35, spot * 0.001, 15) + moneyness * 0.15;
  return Math.round((intrinsic + timeValue) * 100) / 100;
}

function suggestLots(mtfDeploy: number, confidence: number, capitalPerLot: number, isOption = false): number {
  if (capitalPerLot <= 0) return 1;
  let lots = 1;
  if (mtfDeploy >= 70 && confidence >= 58) lots = 2;
  if (mtfDeploy >= 85 && confidence >= 65) lots = isOption ? 2 : 3;
  if (mtfDeploy < 40 || confidence < 45) lots = 1;
  return Math.min(lots, isOption ? 2 : 3);
}

function defaultRiskNotes(spec: FnoUnderlyingSpec, expiry: FnoExpiryInfo): string[] {
  const product = spec.kind === 'stock' ? 'Stock F&O' : 'Index F&O';
  const expiryLine =
    expiry.schedule === 'monthly'
      ? expiry.is_today
        ? 'Monthly expiry today — elevated gamma/theta; reduce size.'
        : `Next monthly expiry: ${expiry.label}.`
      : expiry.is_today
        ? 'Weekly expiry today — elevated gamma/theta; reduce size.'
        : `Next weekly expiry: ${expiry.label}.`;

  return [
    `${product} — verify lot size and margin on NSE/broker before trading.`,
    expiryLine,
    'This is not live option-chain data — strikes and premiums are modelled from spot plan.',
  ];
}
