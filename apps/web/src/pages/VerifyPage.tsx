import { FormEvent, useState } from 'react';
import { api } from '../api';

interface VerifyResult {
  symbol: string;
  success: boolean;
  analysis: {
    intrinsic: number;
    mos: number | null;
    zone: string;
    fair_pe: number;
    quality_score: number;
    recommendation: string;
    final_rating: string;
    graham: number;
    method: string;
  };
  disclaimer: string;
}

export default function VerifyPage() {
  const [symbol, setSymbol] = useState('TCS');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const res = await api<VerifyResult>('/api/v1/verify/auto', {
        method: 'POST',
        body: JSON.stringify({ symbol, refresh: true }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>CFA Verify</h1>
      <p className="disclaimer">One-click memo — confirm with full verify workflow before investing.</p>

      <form className="card" onSubmit={onSubmit}>
        <div className="form-group" style={{ maxWidth: 280 }}>
          <label>Symbol</label>
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="TCS"
            style={{ width: '100%' }}
          />
        </div>
        <button type="submit" className="btn" disabled={loading} style={{ marginTop: '0.75rem' }}>
          {loading ? 'Analyzing…' : 'Auto verify'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {result && (
        <div className="card">
          <h2>
            {result.symbol} — {result.analysis.final_rating}
          </h2>
          <table>
            <tbody>
              <tr>
                <td>Intrinsic value</td>
                <td>₹{result.analysis.intrinsic}</td>
              </tr>
              <tr>
                <td>Margin of safety</td>
                <td>{result.analysis.mos !== null ? `${result.analysis.mos}%` : '—'}</td>
              </tr>
              <tr>
                <td>Fair P/E</td>
                <td>{result.analysis.fair_pe}×</td>
              </tr>
              <tr>
                <td>Graham number</td>
                <td>₹{result.analysis.graham}</td>
              </tr>
              <tr>
                <td>Quality score</td>
                <td>{result.analysis.quality_score}/100</td>
              </tr>
              <tr>
                <td>Method</td>
                <td>{result.analysis.method}</td>
              </tr>
              <tr>
                <td>Verdict</td>
                <td>
                  <strong>{result.analysis.recommendation}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          <p className="disclaimer">{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
