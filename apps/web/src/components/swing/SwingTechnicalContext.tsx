import { emaStackFromTa, fmtMoney, fmtNum, zoneClass } from './format';

interface Props {
  ta: Record<string, unknown>;
}

export function SwingTechnicalContext({ ta }: Props) {
  const stack = emaStackFromTa(ta);
  const chartZone = String(ta.ta_52w_chart_zone ?? '—');
  const lowDate = ta.ta_52w_low_date ? String(ta.ta_52w_low_date) : null;
  const highDate = ta.ta_52w_high_date ? String(ta.ta_52w_high_date) : null;

  const metrics = [
    { label: 'RSI-14', value: fmtNum(ta.ta_rsi14), hint: 'Pullback band 42–54 for E2' },
    { label: 'SMA-50', value: fmtMoney(ta.ta_sma50), hint: 'Primary trend (E1)' },
    { label: 'SMA-200', value: fmtMoney(ta.ta_sma200), hint: 'Long-term structure' },
    { label: 'EMA-21', value: fmtMoney(ta.ta_ema21), hint: 'Pullback anchor (E2/E10)' },
    { label: 'EMA-50', value: fmtMoney(ta.ta_ema50), hint: 'Momentum stack (E7)' },
    {
      label: 'EMA stack',
      value: stack.label,
      valueClass: stack.tone === 'bull' ? 'swing-stack-bull' : stack.tone === 'bear' ? 'swing-stack-bear' : '',
      hint: 'EMA-9 > 21 > 50 bullish',
    },
    { label: '52w %', value: fmtNum(ta.ta_pct_52w, '%'), hint: 'E4 band vs regime' },
    {
      label: 'Chart zone',
      value: chartZone.toUpperCase(),
      valueClass: zoneClass(chartZone),
      hint: lowDate || highDate ? `low ${lowDate ?? '—'} · high ${highDate ?? '—'}` : '52w range zone',
    },
    { label: 'MACD hist', value: fmtNum(ta.ta_macd_hist), hint: 'E3 momentum' },
    { label: 'BB %B', value: fmtNum(ta.ta_bb_pct_b, '%'), hint: 'E5 extension guard' },
    { label: 'Avg value', value: ta.ta_avg_value_cr != null ? `₹${fmtNum(ta.ta_avg_value_cr)} cr` : '—', hint: 'E6 liquidity' },
    { label: 'ATR %', value: fmtNum(ta.ta_atr_pct, '%'), hint: 'Stop width input' },
  ];

  return (
    <section className="card swing-tech-context">
      <h3>Technical context</h3>
      <p className="swing-subsection-hint muted">Same 2Y daily series as entry rules — not the chart tab timeframe.</p>
      <dl className="swing-tech-grid">
        {metrics.map((m) => (
          <div key={m.label} className="swing-tech-tile">
            <dt>{m.label}</dt>
            <dd className={m.valueClass ?? ''} title={m.hint}>
              {m.value}
            </dd>
            <span className="swing-tech-hint">{m.hint}</span>
          </div>
        ))}
      </dl>
    </section>
  );
}
