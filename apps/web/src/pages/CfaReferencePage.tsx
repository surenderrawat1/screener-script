import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { EmptyState, Page, PageHeader } from '../components/PageLayout';

interface CfaTermDto {
  key: string;
  category: string;
  title: string;
  definition: string;
  formula: string | null;
  example: string | null;
  phase_refs: string[];
  related_keys: string[];
  sort_order: number;
  is_active: boolean;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  valuation: 'Valuation',
  ratio: 'Financial Ratios',
  quality: 'Quality & Scoring',
  quant: 'Quant Screens',
  screening: 'Screening',
  phase: 'Verification Phases',
  verdict: 'Verdict & Gates',
};

function categoryLabel(cat: string): string {
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function TermBlock({ term, allTerms }: { term: CfaTermDto; allTerms: Map<string, CfaTermDto> }) {
  return (
    <article className="card cfa-term-card" id={`term-${term.key}`}>
      <h3 style={{ marginTop: 0 }}>{term.title}</h3>
      <p className="cfa-term-key muted">
        <code>{term.key}</code>
        {term.phase_refs.length > 0 && (
          <span> · Phase {term.phase_refs.join(', ')}</span>
        )}
      </p>
      <p>{term.definition}</p>
      {term.formula && (
        <div className="cfa-formula-box">
          <strong>Formula</strong>
          <pre>{term.formula}</pre>
        </div>
      )}
      {term.example && (
        <p className="muted">
          <strong>Example:</strong> {term.example}
        </p>
      )}
      {term.related_keys.length > 0 && (
        <p className="cfa-related">
          <span className="muted">Related: </span>
          {term.related_keys.map((k, i) => {
            const related = allTerms.get(k);
            return (
              <span key={k}>
                {i > 0 ? ' · ' : ''}
                {related ? (
                  <a href={`#term-${k}`}>{related.title}</a>
                ) : (
                  <code>{k}</code>
                )}
              </span>
            );
          })}
        </p>
      )}
    </article>
  );
}

export default function CfaReferencePage() {
  const [terms, setTerms] = useState<CfaTermDto[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<{ terms: CfaTermDto[]; categories: string[] }>('/api/v1/cfa/terms');
      setTerms(data.terms);
      setCategories(data.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load CFA reference');
      setTerms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const termMap = useMemo(() => new Map(terms.map((t) => [t.key, t])), [terms]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return terms.filter((t) => {
      if (category && t.category !== category) return false;
      if (!q) return true;
      return (
        t.key.includes(q) ||
        t.title.toLowerCase().includes(q) ||
        t.definition.toLowerCase().includes(q) ||
        (t.formula?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [terms, filter, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, CfaTermDto[]>();
    for (const t of filtered) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <Page>
      <PageHeader
        title="CFA Reference"
        subtitle="Definitions and formulas used in Verify, Screener, and valuation engine"
      />
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Content is managed by admins and reflects the live glossary in the database.{' '}
        <Link to="/admin/cfa-docs">Edit glossary</Link> (admin only).
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-row">
          <div className="form-group" style={{ flex: 1 }}>
            <label>Search</label>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="MOS, ROE, DCF…"
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-group" style={{ minWidth: 200 }}>
            <label>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: '100%' }}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading CFA reference…</p>}

      {!loading && terms.length === 0 && !error && (
        <EmptyState>
          No CFA terms in the database. Ask an admin to run seed or reseed defaults from{' '}
          <Link to="/admin/cfa-docs">CFA Docs admin</Link>.
        </EmptyState>
      )}

      {grouped.map(([cat, list]) => (
        <section key={cat} style={{ marginBottom: '1.5rem' }}>
          <h2>{categoryLabel(cat)}</h2>
          <div className="cfa-term-grid">
            {list.map((term) => (
              <TermBlock key={term.key} term={term} allTerms={termMap} />
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
