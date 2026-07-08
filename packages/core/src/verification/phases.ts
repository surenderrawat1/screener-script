import type { GateContext } from './gate-helpers.js';
import { gate, phaseResult, yesNoGate } from './gate-helpers.js';
import type { DerivedMetrics, PhaseResult, VerifyInput } from './types.js';
import {
  resolveEffectiveSectorKey,
  resolvePhase6SectorRouting,
  sectorHintKey,
} from './sector-routing.js';

export { resolveEffectiveSectorKey, resolvePhase6SectorRouting, sectorHintKey };

export function evaluatePhase0(input: VerifyInput, ctx: GateContext): PhaseResult {
  const gates = [
    gate(ctx, '0.1', 'Emergency fund 6–12 months expenses', Boolean(input.p0_emergency_fund)),
    gate(ctx, '0.2', 'High-interest debt cleared', Boolean(input.p0_debt_cleared)),
    gate(ctx, '0.3', 'Investing 20–40% income consistently (SIP habit)', Boolean(input.p0_sip_habit)),
    gate(ctx, '0.4', 'Asset allocation defined', Boolean(input.p0_asset_allocation)),
    gate(ctx, '0.5', 'Emotional discipline — no FOMO / panic plan', Boolean(input.p0_emotional_discipline)),
  ];

  const blocked = !input.p0_emergency_fund || !input.p0_debt_cleared;
  if (blocked) {
    ctx.gateWarnings.push('Phase 0 gate: Fix emergency fund and high-interest debt before stock picking.');
  }

  return phaseResult(
    0,
    'Investor Foundation',
    gates,
    5,
    blocked ? 'Fix personal finance first' : null,
    blocked,
  );
}

export function evaluatePhase1(
  input: VerifyInput,
  metrics: DerivedMetrics,
  ctx: GateContext,
): PhaseResult {
  let pledgeNote = 'Pledge > 25% = CRITICAL FAIL';
  if (String(input.pledge_data_as_of ?? '') === '' && Number(input.p1_promoter_pledge ?? 0) === 0) {
    pledgeNote += ' · Upload pledge CSV on Cache page or enter manually';
  }

  const gates = [
    yesNoGate(
      ctx,
      '1.1',
      'Can explain business model in 2 sentences',
      input.p1_business_model as boolean | null,
      1,
      true,
      'Circle of competence — REJECT if No',
    ),
    yesNoGate(
      ctx,
      '1.2',
      'Know how company makes money',
      input.p1_revenue_model as boolean | null,
      1,
      true,
      'Circle of competence — REJECT if No',
    ),
    yesNoGate(
      ctx,
      '1.3',
      'Industry outlook understood (growing/stable/declining)',
      String(input.p1_industry_outlook ?? '') !== '' ? true : null,
    ),
    yesNoGate(ctx, '1.4', 'Inside circle of competence', input.p1_circle_competence as boolean | null),
    yesNoGate(ctx, '1.5', 'Promoter holding stable', input.p1_promoter_stable as boolean | null),
    gate(
      ctx,
      '1.6',
      'Promoter pledge ≤ 10%',
      Number(input.p1_promoter_pledge ?? 0) <= 10,
      1,
      Number(input.p1_promoter_pledge ?? 0) > 25,
      pledgeNote,
    ),
    yesNoGate(
      ctx,
      '1.7',
      'Capital allocation track record good',
      input.p1_capital_allocation as boolean | null,
    ),
    yesNoGate(ctx, '1.8', 'Related-party transactions normal', input.p1_rpt_normal as boolean | null),
    yesNoGate(ctx, '1.9', 'Auditor clean (no qualified opinion)', input.p1_auditor_clean as boolean | null),
  ];

  const moatPts = Math.min(2, Math.floor(metrics.moat_count / 2));
  gates.push({
    id: '1B',
    label: `Economic moat score (${metrics.moat_strength})`,
    status: moatPts >= 1 ? 'pass' : 'warn',
    points: moatPts,
    max: 2,
    critical: false,
    note: '',
  });

  return phaseResult(1, 'Business Quality', gates, 10);
}

export function evaluatePhase2(
  input: VerifyInput,
  metrics: DerivedMetrics,
  ctx: GateContext,
): PhaseResult {
  const receivablesSpiking = String(input.receivable_days_trend ?? '') === 'ballooning';
  const cfoPatFail = input.p2_cfo_pat === false;

  if (cfoPatFail && receivablesSpiking) {
    ctx.criticalFails.push({
      id: '2.8',
      label: 'CFO tracks PAT + receivables spiking',
      note: 'Earnings quality doubt — REJECT or WATCHLIST',
    });
  }

  const autoRevenueGrowing = metrics.revenue_trend === 'growing';
  const autoMarginsOk =
    Number(input.ebitda_margin_latest ?? 0) >= Number(input.ebitda_margin_prev ?? 0) ||
    Number(input.ebitda_margin_prev ?? 0) === 0;
  const autoDeOk = metrics.de <= 0.5 || input.p2_de_ok === true;
  const autoBvGrowing =
    Number(input.book_value_latest ?? 0) > Number(input.book_value_prev ?? 0) ||
    Number(input.book_value_prev ?? 0) === 0;
  const autoFcfPositive = metrics.fcf > 0;

  const gates = [
    gate(
      ctx,
      '2.1',
      'Revenue growing over 3–5 years',
      input.p2_revenue_growing !== null && input.p2_revenue_growing !== undefined
        ? Boolean(input.p2_revenue_growing)
        : autoRevenueGrowing,
    ),
    gate(
      ctx,
      '2.2',
      'PAT not purely one-time items',
      input.p2_pat_quality !== null && input.p2_pat_quality !== undefined ? Boolean(input.p2_pat_quality) : true,
    ),
    gate(
      ctx,
      '2.3',
      'Margins stable or expanding',
      input.p2_margins_ok !== null && input.p2_margins_ok !== undefined ? Boolean(input.p2_margins_ok) : autoMarginsOk,
    ),
    gate(ctx, '2.4', 'D/E manageable for sector', autoDeOk),
    gate(
      ctx,
      '2.5',
      'Book value growing over time',
      input.p2_bv_growing !== null && input.p2_bv_growing !== undefined ? Boolean(input.p2_bv_growing) : autoBvGrowing,
    ),
    gate(
      ctx,
      '2.6',
      'Working capital not exploding',
      input.p2_wc_ok !== null && input.p2_wc_ok !== undefined
        ? Boolean(input.p2_wc_ok)
        : String(input.receivable_days_trend ?? '') !== 'ballooning' &&
          String(input.inventory_days_trend ?? '') !== 'ballooning',
    ),
    gate(
      ctx,
      '2.7',
      'FCF positive or clear path',
      input.p2_fcf_positive !== null && input.p2_fcf_positive !== undefined
        ? Boolean(input.p2_fcf_positive)
        : autoFcfPositive,
    ),
    gate(
      ctx,
      '2.8',
      'CFO tracks PAT (no persistent gap)',
      !(cfoPatFail && receivablesSpiking),
      1,
      cfoPatFail && receivablesSpiking,
    ),
    gate(
      ctx,
      '2.9',
      'FCF covers dividend (if dividend stock)',
      input.p2_fcf_dividend !== null && input.p2_fcf_dividend !== undefined
        ? Boolean(input.p2_fcf_dividend)
        : Number(input.dividend_paid_cr ?? 0) <= 0 || metrics.fcf >= Number(input.dividend_paid_cr ?? 0),
    ),
  ];

  const annualScan =
    Number(input.p2_chairman_honest ? 1 : 0) +
    Number(input.p2_auditor_clean ? 1 : 0) +
    Number(input.p2_contingent_ok ? 1 : 0) +
    Number(input.p2_accounting_ok ? 1 : 0);

  gates.push({
    id: '2D',
    label: 'Annual report scan (4 sections clean)',
    status: annualScan >= 3 ? 'pass' : annualScan >= 2 ? 'warn' : 'fail',
    points: Math.min(1, annualScan >= 3 ? 1 : 0),
    max: 0,
    critical: false,
    note: `${annualScan}/4 clean`,
  });

  return phaseResult(2, 'Financial Statements', gates, 9);
}

export function evaluatePhase3(
  input: VerifyInput,
  metrics: DerivedMetrics,
  ctx: GateContext,
): PhaseResult {
  const roe = Number(input.roe ?? 0);
  const roce = Number(input.roce ?? 0);
  const leverageTrap = roe > 15 && roce < roe - 5 && metrics.de > 1.5;

  if (leverageTrap) {
    ctx.criticalFails.push({
      id: '3.leverage',
      label: 'Leverage trap (high ROE, low ROCE, D/E > 1.5)',
      note: 'ROE inflated by debt — REJECT',
    });
  }

  let ratioPasses = 0;
  if (roe >= 15) ratioPasses++;
  if (roce >= 15) ratioPasses++;
  if (metrics.de <= 0.5) ratioPasses++;
  if (Number(input.interest_coverage ?? 0) >= 3 || Number(input.interest_coverage ?? 0) === 0) ratioPasses++;
  if (metrics.peg > 0 && metrics.peg <= 1.5) ratioPasses++;
  if (metrics.fcf_yield >= 3 || metrics.fcf > 0) ratioPasses++;

  const gates = [
    yesNoGate(
      ctx,
      '3.1',
      'ROE > 15% for 3+ years',
      input.roe_3yr_above_15 !== null && input.roe_3yr_above_15 !== undefined
        ? (input.roe_3yr_above_15 as boolean)
        : roe >= 15
          ? true
          : null,
    ),
    yesNoGate(
      ctx,
      '3.2',
      'ROCE within 5% of ROE (low leverage)',
      input.roce_near_roe !== null && input.roce_near_roe !== undefined
        ? (input.roce_near_roe as boolean)
        : Math.abs(roe - roce) <= 5
          ? true
          : null,
    ),
    yesNoGate(
      ctx,
      '3.3',
      'High ROE from operations, not only debt',
      input.roe_from_operations !== null && input.roe_from_operations !== undefined
        ? (input.roe_from_operations as boolean)
        : !leverageTrap
          ? true
          : false,
      1,
      leverageTrap,
    ),
    gate(ctx, '3.r1', 'ROE ≥ 15%', roe >= 15),
    gate(ctx, '3.r2', 'ROCE ≥ 15%', roce >= 15),
    gate(
      ctx,
      '3.r3',
      'D/E ≤ 0.5 (non-financial)',
      metrics.de <= 0.5 ||
        String(input.sector ?? '') === 'banking' ||
        (String(input.sector ?? '') === 'nbfc' && metrics.de < 4),
    ),
    gate(
      ctx,
      '3.r4',
      'Interest coverage ≥ 3×',
      Number(input.interest_coverage ?? 0) >= 3 || Number(input.interest_coverage ?? 0) === 0,
    ),
    gate(ctx, '3.r5', 'PEG ≤ 1.5', metrics.peg > 0 && metrics.peg <= 1.5),
    gate(ctx, '3.r6', 'FCF yield positive / FCF > 0', metrics.fcf > 0),
    gate(ctx, '3.r7', 'Ratio quality score', ratioPasses >= 4),
  ];

  const phaseScore = gates.reduce((sum, g) => sum + g.points, 0);
  if (phaseScore <= 4 && !leverageTrap) {
    ctx.gateWarnings.push('Phase 3 score weak (≤4) — consider REJECT unless special situation.');
  }

  return phaseResult(3, 'Fundamental Ratios', gates, 10);
}

export function evaluatePhase4(
  input: VerifyInput,
  metrics: DerivedMetrics,
  ctx: GateContext,
): PhaseResult {
  const vtCount = metrics.value_trap_count;

  if (vtCount >= 3) {
    ctx.criticalFails.push({
      id: '4.value_trap',
      label: '3+ value trap signals',
      note: 'Classic value trap — REJECT',
    });
  }

  const mos = metrics.margin_of_safety;
  const mosZone =
    mos === null
      ? 'Unknown'
      : mos >= 25
        ? 'Deep value'
        : mos >= 15
          ? 'Buy zone'
          : mos >= 0
            ? 'Fair'
            : 'Expensive';

  const gates = [
    gate(ctx, '4.mos', `Margin of safety (${mosZone})`, mos !== null && mos >= 15, 2),
    gate(ctx, '4.1', 'Not: low P/E + declining revenue 3+ yrs', !input.vt_revenue_declining),
    gate(ctx, '4.2', 'Not: high dividend but FCF cannot pay', !input.vt_div_fcf_mismatch),
    gate(ctx, '4.3', 'Not: structurally disrupted industry', !input.vt_industry_disrupted),
    gate(ctx, '4.4', 'Not: high debt + falling margins', !input.vt_debt_falling_margin),
    gate(ctx, '4.5', 'Not: cheap due to permanent decline', !input.vt_permanent_decline, 1, vtCount >= 3),
  ];

  if (metrics.graham_credible && (metrics.graham_number ?? 0) > 0) {
    const grahamPass = Number(input.current_price ?? 0) <= metrics.graham_number * 1.1;
    gates.push(gate(ctx, '4.graham', 'Price ≤ 1.1× Graham (value anchor)', grahamPass, 1));
  }

  if (input.is_growth_stock) {
    gates.push(
      yesNoGate(
        ctx,
        '4.6',
        'Revenue growth > 15% (3-yr CAGR)',
        input.p4_revenue_cagr !== null && input.p4_revenue_cagr !== undefined
          ? (input.p4_revenue_cagr as boolean)
          : Number(input.revenue_growth_3yr ?? 0) >= 15
            ? true
            : null,
      ),
    );
    gates.push(
      yesNoGate(ctx, '4.7', 'EPS growth keeping pace', input.p4_eps_growth_pace as boolean | null),
    );
    gates.push(
      yesNoGate(
        ctx,
        '4.8',
        'PEG ≤ 1.5',
        input.p4_peg_ok !== null && input.p4_peg_ok !== undefined
          ? (input.p4_peg_ok as boolean)
          : metrics.peg > 0 && metrics.peg <= 1.5
            ? true
            : null,
      ),
    );
    gates.push(yesNoGate(ctx, '4.9', 'Scalable model', input.p4_scalable as boolean | null));
    gates.push(yesNoGate(ctx, '4.10', 'Runway 5+ years visible', input.p4_runway as boolean | null));
  }

  const thesisFilled =
    String(input.mr_price_reason ?? '').length > 10 &&
    String(input.mr_business_vs_sentiment ?? '').length > 5;
  gates.push(yesNoGate(ctx, '4D', 'Mr. Market check completed', thesisFilled ? true : null, 1));

  return phaseResult(4, 'Value vs Growth Fit', gates, 10);
}

export function evaluatePhase5(
  input: VerifyInput,
  metrics: DerivedMetrics,
  ctx: GateContext,
): PhaseResult {
  const fScore = metrics.piotroski;
  const zScore = metrics.altman_z;

  const fPass =
    input.p5_fscore_ok !== null && input.p5_fscore_ok !== undefined
      ? (input.p5_fscore_ok as boolean)
      : fScore >= 0
        ? fScore >= 7
        : null;

  const zUnreliable = (metrics.z_score_source ?? '') === 'unreliable';
  const zPass = input.altman_skip
    ? true
    : zUnreliable
      ? null
      : input.p5_zscore_ok !== null && input.p5_zscore_ok !== undefined
        ? (input.p5_zscore_ok as boolean)
        : zScore > 0
          ? zScore > 2.99
          : null;

  let zGateValue: boolean | null = null;
  if (input.altman_skip) {
    zGateValue = true;
  } else if (zUnreliable) {
    zGateValue = null;
  } else if (typeof zPass === 'boolean') {
    zGateValue = zPass;
  } else if (zScore > 0) {
    zGateValue = zScore > 2.99;
  }

  const dcfPass =
    input.p5_dcf_sanity !== null && input.p5_dcf_sanity !== undefined
      ? (input.p5_dcf_sanity as boolean)
      : metrics.intrinsic_value > 0
        ? metrics.intrinsic_value >= Number(input.current_price ?? 0)
        : null;

  const gates = [
    yesNoGate(
      ctx,
      '5.1',
      'F-Score ≥ 7 OR quality manually verified',
      typeof fPass === 'boolean' ? fPass : fScore >= 7,
      1,
    ),
    yesNoGate(
      ctx,
      '5.2',
      'Not in financial distress (Z-score > 2.99)',
      typeof zGateValue === 'boolean' ? zGateValue : null,
      1,
    ),
    yesNoGate(
      ctx,
      '5.3',
      'DCF sanity — IV ≥ price',
      typeof dcfPass === 'boolean' ? dcfPass : null,
      1,
    ),
  ];

  if (fScore >= 0) {
    gates[0]!.note = `F-Score: ${fScore}/9`;
  }
  if (zScore > 0 && !input.altman_skip) {
    if ((metrics.z_score_source ?? '') === 'unreliable') {
      gates[1]!.note = 'Z-Score proxy unreliable — re-enter from annual report';
    } else {
      gates[1]!.note = `Z-Score: ${zScore.toFixed(2)}`;
    }
  }

  return phaseResult(5, 'Quant Screens', gates, 3);
}

export function evaluatePhase6(
  input: VerifyInput,
  metrics: DerivedMetrics,
  ctx: GateContext,
  sectorHints: Record<string, string> = {},
): PhaseResult {
  const routing = resolvePhase6SectorRouting(input, metrics, sectorHints);
  const sectorKey = routing.key;
  const gates = [];

  switch (sectorKey) {
    case 'banking': {
      const checks: [string, boolean][] = [
        ['NIM > 3%', Number(input.bank_nim ?? 0) > 3],
        ['GNPA < 3%', Number(input.bank_gnpa ?? 0) < 3 && Number(input.bank_gnpa ?? 0) >= 0],
        ['NNPA < 1%', Number(input.bank_nnpa ?? 0) < 1 && Number(input.bank_nnpa ?? 0) >= 0],
        ['CASA > 35%', Number(input.bank_casa ?? 0) > 35],
        ['ROA > 1%', Number(input.bank_roa ?? 0) > 1],
        ['PCR > 70%', Number(input.bank_pcr ?? 0) > 70],
      ];
      const passCount = checks.filter((c) => c[1]).length;
      gates.push(
        gate(ctx, '6.bank', `Banking sector KPIs (${passCount}/6)`, passCount >= 4, 3),
      );
      break;
    }

    case 'nbfc': {
      const de = Number(input.debt_to_equity ?? 0);
      gates.push(gate(ctx, '6.nbfc1', 'ROE ≥ 15%', Number(input.roe ?? 0) >= 15));
      gates.push(gate(ctx, '6.nbfc2', 'D/E < 4 (NBFC leverage band)', de < 4 || de === 0));
      gates.push(
        gate(
          ctx,
          '6.nbfc3',
          'Interest coverage ≥ 2×',
          Number(input.interest_coverage ?? 0) >= 2 || Number(input.interest_coverage ?? 0) === 0,
        ),
      );
      break;
    }

    case 'insurance': {
      let pb = Number(input.pb_ratio ?? 0);
      if (pb <= 0) {
        const price = Number(input.current_price ?? 0);
        const bv = Number(input.book_value ?? 0);
        pb = bv > 0 && price > 0 ? price / bv : 0;
      }
      gates.push(gate(ctx, '6.ins1', 'ROE ≥ 12%', Number(input.roe ?? 0) >= 12));
      gates.push(gate(ctx, '6.ins2', 'P/B within sector band (0.8–3.5)', pb >= 0.8 && pb <= 3.5));
      gates.push(
        yesNoGate(ctx, '6.ins3', 'Embedded value / solvency reviewed', input.p6_kpi_identified as boolean | null),
      );
      break;
    }

    case 'oil_gas':
      gates.push(gate(ctx, '6.og1', 'ROCE ≥ 10%', Number(input.roce ?? 0) >= 10));
      gates.push(yesNoGate(ctx, '6.og2', 'Commodity cycle / capex understood', input.p6_macro_noted as boolean | null));
      gates.push(yesNoGate(ctx, '6.og3', 'Peer EV/EBITDA compared', input.p6_peer_compared as boolean | null));
      break;

    case 'defence': {
      const obRatio =
        Number(input.def_ob_revenue_ratio ?? 0) > 0
          ? Number(input.def_ob_revenue_ratio)
          : Number(input.revenue_latest ?? 0) > 0
            ? Number(input.def_order_book ?? 0) / Number(input.revenue_latest)
            : 0;
      gates.push(gate(ctx, '6.def1', 'Order book ÷ Revenue > 2×', obRatio >= 2, 1));
      gates.push(
        gate(ctx, '6.def2', 'EBITDA margin trend stable/up', String(input.def_ebitda_trend ?? '') !== 'down', 1),
      );
      gates.push(
        yesNoGate(ctx, '6.def3', 'Execution history acceptable', input.def_execution_ok as boolean | null, 1),
      );
      break;
    }

    case 'it':
      gates.push(
        gate(
          ctx,
          '6.it1',
          'Attrition not spiking',
          Number(input.it_attrition ?? 0) <= 20 || Number(input.it_attrition ?? 0) === 0,
          1,
        ),
      );
      gates.push(
        gate(
          ctx,
          '6.it2',
          'No single client > 20%',
          Number(input.it_client_concentration ?? 0) <= 20 ||
            Number(input.it_client_concentration ?? 0) === 0,
          1,
        ),
      );
      gates.push(
        gate(
          ctx,
          '6.it3',
          'Revenue growth positive',
          Number(input.it_rev_growth ?? 0) > 0 || Number(input.revenue_growth_3yr ?? 0) > 0,
          1,
        ),
      );
      break;

    case 'metal': {
      const de = Number(metrics.de ?? input.debt_to_equity ?? 0);
      gates.push(gate(ctx, '6.met1', 'ROCE ≥ 10%', Number(input.roce ?? 0) >= 10));
      gates.push(gate(ctx, '6.met2', 'D/E ≤ 1.5 (cycle-adjusted)', de <= 1.5 || de === 0));
      gates.push(
        yesNoGate(ctx, '6.met3', 'Commodity cycle position understood', input.p6_macro_noted as boolean | null, 1),
      );
      break;
    }

    case 'cement': {
      const de = Number(metrics.de ?? input.debt_to_equity ?? 0);
      gates.push(gate(ctx, '6.cem1', 'ROCE ≥ 12%', Number(input.roce ?? 0) >= 12));
      gates.push(gate(ctx, '6.cem2', 'D/E ≤ 1.2', de <= 1.2 || de === 0));
      gates.push(
        yesNoGate(ctx, '6.cem3', 'Regional demand / capacity cycle noted', input.p6_macro_noted as boolean | null, 1),
      );
      break;
    }

    case 'fmcg': {
      const marginsOk =
        Number(input.ebitda_margin_latest ?? 0) >= Number(input.ebitda_margin_prev ?? 0) ||
        Number(input.ebitda_margin_prev ?? 0) === 0;
      gates.push(gate(ctx, '6.fmcg1', 'EBITDA margin stable/up', marginsOk));
      gates.push(gate(ctx, '6.fmcg2', 'Revenue growth positive', Number(input.revenue_growth_3yr ?? 0) > 0));
      gates.push(
        yesNoGate(ctx, '6.fmcg3', 'Brand/pricing power vs peers reviewed', input.p6_peer_compared as boolean | null, 1),
      );
      break;
    }

    case 'pharma':
      gates.push(gate(ctx, '6.phm1', 'ROE ≥ 15%', Number(input.roe ?? 0) >= 15));
      gates.push(gate(ctx, '6.phm2', 'Revenue growth positive', Number(input.revenue_growth_3yr ?? 0) > 0));
      gates.push(
        yesNoGate(ctx, '6.phm3', 'Regulatory / pipeline KPI reviewed', input.p6_kpi_identified as boolean | null, 1),
      );
      break;

    case 'auto': {
      const volGrowth =
        Number(input.auto_volume_growth ?? 0) > 0
          ? Number(input.auto_volume_growth)
          : Number(input.it_rev_growth ?? 0) > 0
            ? Number(input.it_rev_growth)
            : Number(input.revenue_growth_3yr ?? 0);
      gates.push(gate(ctx, '6.auto1', 'Volume/revenue growth positive', volGrowth > 0));
      gates.push(gate(ctx, '6.auto2', 'ROCE ≥ 12%', Number(input.roce ?? 0) >= 12));
      gates.push(
        yesNoGate(ctx, '6.auto3', 'Cycle / EV transition noted', input.p6_macro_noted as boolean | null, 1),
      );
      break;
    }

    case 'telecom': {
      const marginsOk =
        Number(input.ebitda_margin_latest ?? 0) >= Number(input.ebitda_margin_prev ?? 0) ||
        Number(input.ebitda_margin_prev ?? 0) === 0;
      gates.push(
        gate(
          ctx,
          '6.tel1',
          'Interest coverage ≥ 2× (debt service)',
          Number(input.interest_coverage ?? 0) >= 2 || Number(input.interest_coverage ?? 0) === 0,
        ),
      );
      gates.push(gate(ctx, '6.tel2', 'EBITDA margin stable/up', marginsOk));
      gates.push(
        yesNoGate(ctx, '6.tel3', 'ARPU / subscriber KPI reviewed', input.p6_kpi_identified as boolean | null, 1),
      );
      if (Number(input.telecom_arpu ?? 0) > 0) {
        gates[2]!.note = `ARPU ₹${Math.round(Number(input.telecom_arpu)).toLocaleString('en-IN')}`;
      }
      break;
    }

    case 'utility': {
      const de = Number(metrics.de ?? input.debt_to_equity ?? 0);
      const plfOk = Number(input.utility_plf ?? 0) >= 55 || input.infra_kpi_ok === true;
      gates.push(gate(ctx, '6.uti1', 'ROE ≥ 10%', Number(input.roe ?? 0) >= 10));
      gates.push(gate(ctx, '6.uti2', 'D/E ≤ 2.0', de <= 2.0 || de === 0));
      gates.push(gate(ctx, '6.uti3', 'PLF / regulatory KPI acceptable', plfOk, 1));
      if (Number(input.utility_plf ?? 0) > 0) {
        gates[2]!.note = `PLF ${Number(input.utility_plf).toFixed(1)}%`;
      }
      break;
    }

    case 'reit': {
      const de = Number(metrics.de ?? input.debt_to_equity ?? 0);
      const yieldVal = Number(input.dividend_yield ?? 0);
      gates.push(gate(ctx, '6.reit1', 'Distribution yield positive', yieldVal > 0));
      gates.push(gate(ctx, '6.reit2', 'D/E ≤ 1.5', de <= 1.5 || de === 0));
      gates.push(
        yesNoGate(ctx, '6.reit3', 'NAV / occupancy reviewed', input.p6_kpi_identified as boolean | null, 1),
      );
      break;
    }

    case 'infra':
      gates.push(
        yesNoGate(ctx, '6.infra1', 'Sector KPI acceptable (PLF/spread/NIM)', input.infra_kpi_ok as boolean | null, 1),
      );
      gates.push(
        yesNoGate(ctx, '6.infra2', 'Regulatory risk understood', input.infra_regulatory_ok as boolean | null, 1),
      );
      gates.push(
        yesNoGate(ctx, '6.infra3', 'Asset quality acceptable', input.infra_asset_quality as boolean | null, 1),
      );
      break;

    default:
      gates.push(
        yesNoGate(ctx, '6.1', 'Sector-specific KPI identified', input.p6_kpi_identified as boolean | null, 1),
      );
      gates.push(yesNoGate(ctx, '6.2', 'Compared to 2 peers on KPI', input.p6_peer_compared as boolean | null, 1));
      gates.push(yesNoGate(ctx, '6.3', 'Macro tailwind/headwind noted', input.p6_macro_noted as boolean | null, 1));
      break;
  }

  if (routing.note !== '' && gates.length > 0) {
    gates[0]!.note = `${gates[0]!.note ?? ''} · ${routing.note}`.trim();
  }

  const result = phaseResult(6, 'Sector Checks', gates, 3);
  result.sector_key = sectorKey;
  return result;
}

export function evaluatePhase7(
  input: VerifyInput,
  _metrics: DerivedMetrics,
  ctx: GateContext,
): PhaseResult {
  const exitTriggers =
    Number(input.exit_thesis_broken ? 1 : 0) +
    Number(input.exit_pledge_fraud ? 1 : 0) +
    Number(input.exit_fundamentals_bad ? 1 : 0) +
    Number(input.exit_overvalued_25 ? 1 : 0) +
    Number(input.exit_down_25_redflags ? 1 : 0);

  if (input.already_holding && exitTriggers >= 1) {
    ctx.criticalFails.push({
      id: '7.exit',
      label: 'Exit trigger activated',
      note: 'One or more exit conditions met — consider EXIT',
    });
  }

  const gates = [
    yesNoGate(ctx, '7.1', 'Fits asset allocation', input.p7_allocation_fit as boolean | null),
    yesNoGate(
      ctx,
      '7.2',
      'Single stock ≤ 5–10% of portfolio',
      input.p7_position_size_ok !== null && input.p7_position_size_ok !== undefined
        ? (input.p7_position_size_ok as boolean)
        : Number(input.portfolio_pct ?? 0) <= 10 || Number(input.portfolio_pct ?? 0) === 0,
    ),
    yesNoGate(
      ctx,
      '7.3',
      'Sector not overweight (> 25%)',
      input.p7_sector_not_overweight !== null && input.p7_sector_not_overweight !== undefined
        ? (input.p7_sector_not_overweight as boolean)
        : Number(input.sector_portfolio_pct ?? 0) <= 25 || Number(input.sector_portfolio_pct ?? 0) === 0,
    ),
    yesNoGate(ctx, '7.4', 'Correlation with holdings acceptable', input.p7_correlation_ok as boolean | null),
    yesNoGate(ctx, '7.5', 'Entry plan defined (lump sum / tranches / SIP)', input.p7_entry_plan as boolean | null),
    yesNoGate(
      ctx,
      '7.6',
      'Portfolio 12–20 stocks (not over-concentrated)',
      input.p7_portfolio_diversified as boolean | null,
    ),
  ];

  if (input.already_holding) {
    gates.push({
      id: '7.exit',
      label: 'Exit triggers (0 = hold)',
      status: exitTriggers === 0 ? 'pass' : 'critical',
      points: 0,
      max: 0,
      critical: exitTriggers > 0,
      note: `${exitTriggers} exit trigger(s) active`,
    });
  }

  return phaseResult(7, 'Portfolio Fit', gates, 6);
}

export function evaluatePhase8(input: VerifyInput, ctx: GateContext): PhaseResult {
  const thesisComplete =
    String(input.thesis_business ?? '').length >= 20 &&
    String(input.thesis_financials ?? '').length >= 20 &&
    String(input.thesis_valuation ?? '').length >= 20;
  const invalidationComplete =
    String(input.invalidation_1 ?? '').length >= 10 && String(input.invalidation_2 ?? '').length >= 10;
  const reviewSet = String(input.review_date ?? '') !== '';

  const gates = [
    gate(ctx, '8.1', 'Thesis: Why good business?', String(input.thesis_business ?? '').length >= 20),
    gate(ctx, '8.2', 'Thesis: 3 metrics prove quality', String(input.thesis_financials ?? '').length >= 20),
    gate(ctx, '8.3', 'Thesis: Why price attractive (MOS)?', String(input.thesis_valuation ?? '').length >= 20),
    gate(ctx, '8.4', 'Invalidation triggers defined (2)', invalidationComplete),
    gate(ctx, '8.5', 'Review date set', reviewSet),
  ];

  return phaseResult(8, 'Final Thesis', gates, 0, thesisComplete ? null : 'Complete thesis before buying');
}
