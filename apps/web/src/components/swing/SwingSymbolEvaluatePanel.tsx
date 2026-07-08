import { SwingAddPositionForm } from './SwingAddPositionForm';
import { SwingEntryRulesTable } from './SwingEntryRulesTable';
import { SwingExitRulesReference } from './SwingExitRulesReference';
import { SwingExitTestPanel } from './SwingExitTestPanel';
import { SwingScoreBreakdown } from './SwingScoreBreakdown';
import { SwingSymbolSummary } from './SwingSymbolSummary';
import { SwingTechnicalContext } from './SwingTechnicalContext';
import { SwingTradePlan } from './SwingTradePlan';
import type { SwingEvaluateResponse } from './types';

interface Props {
  evalData: SwingEvaluateResponse;
  loading?: boolean;
  onPositionAdded?: () => void;
}

export function SwingSymbolEvaluatePanel({ evalData, loading = false, onPositionAdded }: Props) {
  const entry = evalData.entry;
  const ta = evalData.ta ?? {};
  const regime = evalData.regime ?? entry.regime ?? {};
  const symbol = String(evalData.symbol ?? '');
  const price = Number(evalData.price ?? entry.entry_price ?? 0);
  const rules = entry.rules ?? [];

  return (
    <div className={`swing-symbol-layout${loading ? ' is-refreshing' : ''}`}>
      {loading ? (
        <div className="swing-panel-loading" aria-live="polite">
          Refreshing evaluation…
        </div>
      ) : null}

      <section className="card swing-symbol-entry swing-symbol-main">
        <SwingSymbolSummary
          symbol={symbol}
          price={price}
          asOfDate={evalData.as_of_date}
          entry={entry}
          regime={regime}
          engineMeta={evalData.engine_meta}
          scanEligibility={evalData.scan_eligibility}
        />

        <div className="swing-symbol-columns">
          <div className="swing-symbol-col">
            <SwingScoreBreakdown entry={entry} engineMeta={evalData.engine_meta} />
            <div className="swing-plan-exit-group">
              <SwingTradePlan entry={entry} />
              <SwingExitRulesReference engineMeta={evalData.engine_meta} embedded />
              <SwingExitTestPanel symbol={symbol} entry={entry} asOfDate={evalData.as_of_date} />
            </div>
          </div>
          <div className="swing-symbol-col swing-symbol-col-side">
            <SwingAddPositionForm
              symbol={symbol}
              price={price}
              asOfDate={evalData.as_of_date}
              entry={entry}
              onAdded={onPositionAdded}
            />
          </div>
        </div>

        <section className="swing-subsection swing-rules-section">
          <h3>Entry rules (E1–E11)</h3>
          <p className="swing-subsection-hint muted">
            Strict ENTER requires score floor, R ≥ {entry.min_r_multiple ?? evalData.engine_meta?.min_r_multiple ?? 3},
            liquidity, and net edge after charges.
          </p>
          <SwingEntryRulesTable rules={rules} />
        </section>
      </section>

      <aside className="swing-symbol-aside">
        <SwingTechnicalContext ta={ta} />
      </aside>
    </div>
  );
}
