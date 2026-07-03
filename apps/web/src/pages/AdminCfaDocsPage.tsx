import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page, PageHeader } from '../components/PageLayout';

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

const EMPTY_FORM = {
  key: '',
  category: 'valuation',
  title: '',
  definition: '',
  formula: '',
  example: '',
  phaseRefs: '',
  relatedKeys: '',
  sortOrder: 0,
  isActive: true,
};

export default function AdminCfaDocsPage() {
  const [terms, setTerms] = useState<CfaTermDto[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ terms: CfaTermDto[]; categories: string[] }>('/api/v1/admin/cfa/terms');
      setTerms(data.terms);
      setCategories(data.categories);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load terms');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function selectTerm(term: CfaTermDto) {
    setSelectedKey(term.key);
    setForm({
      key: term.key,
      category: term.category,
      title: term.title,
      definition: term.definition,
      formula: term.formula ?? '',
      example: term.example ?? '',
      phaseRefs: term.phase_refs.join(', '),
      relatedKeys: term.related_keys.join(', '),
      sortOrder: term.sort_order,
      isActive: term.is_active,
    });
    setMessage('');
    setError('');
  }

  function newTerm() {
    setSelectedKey(null);
    setForm({ ...EMPTY_FORM });
    setMessage('');
    setError('');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');
    try {
      const body = {
        key: form.key.trim(),
        category: form.category.trim(),
        title: form.title.trim(),
        definition: form.definition.trim(),
        formula: form.formula.trim() || null,
        example: form.example.trim() || null,
        phaseRefs: form.phaseRefs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        relatedKeys: form.relatedKeys
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      };
      const method = selectedKey ? 'PUT' : 'POST';
      const url = selectedKey
        ? `/api/v1/admin/cfa/terms/${encodeURIComponent(selectedKey)}`
        : '/api/v1/admin/cfa/terms';
      await api(url, { method, body: JSON.stringify(body) });
      setMessage(selectedKey ? 'Term updated.' : 'Term created.');
      await load();
      setSelectedKey(body.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  async function onDelete() {
    if (!selectedKey || !confirm(`Delete term "${selectedKey}"?`)) return;
    setLoading(true);
    try {
      await api(`/api/v1/admin/cfa/terms/${encodeURIComponent(selectedKey)}`, { method: 'DELETE' });
      setMessage('Term deleted.');
      newTerm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setLoading(false);
    }
  }

  async function onReseed() {
    if (!confirm('Reset all default terms from codebase? Custom text on defaults will be overwritten.')) return;
    setLoading(true);
    try {
      const result = await api<{ inserted: number; count: number }>('/api/v1/admin/cfa/terms/reseed', {
        method: 'POST',
      });
      setMessage(`Reseeded defaults (${result.count} terms in glossary).`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reseed failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="CFA Docs Admin"
        subtitle="Edit definitions and formulas shown in Verify, Screener, and CFA Reference"
      />
      <p className="muted">
        <Link to="/admin">← Admin home</Link>
        {' · '}
        <Link to="/cfa-reference">View public reference</Link>
      </p>

      <div className="cfa-admin-layout">
        <aside className="card cfa-admin-list">
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={newTerm}>
              + New term
            </button>
            <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void onReseed()}>
              Reseed defaults
            </button>
          </div>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            {terms.length} terms · {categories.length} categories
          </p>
          <ul className="cfa-term-list">
            {terms.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  className={selectedKey === t.key ? 'cfa-term-list-active' : ''}
                  onClick={() => selectTerm(t)}
                >
                  <strong>{t.title}</strong>
                  <small>
                    <code>{t.key}</code>
                    {!t.is_active && ' · hidden'}
                  </small>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <form className="card cfa-admin-form" onSubmit={onSubmit}>
          <h2 style={{ marginTop: 0 }}>{selectedKey ? 'Edit term' : 'New term'}</h2>
          {message && <p className="message-success">{message}</p>}
          {error && <p className="error">{error}</p>}

          <div className="form-group">
            <label>Key (snake_case, immutable after create)</label>
            <input
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
              disabled={Boolean(selectedKey)}
              required
              pattern="[a-z][a-z0-9_]*"
              placeholder="mos"
            />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Category</label>
              <input
                list="cfa-categories"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                required
              />
              <datalist id="cfa-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
                <option value="valuation" />
                <option value="ratio" />
                <option value="quality" />
                <option value="quant" />
                <option value="phase" />
                <option value="verdict" />
                <option value="screening" />
              </datalist>
            </div>
            <div className="form-group" style={{ width: 100 }}>
              <label>Sort</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value, 10) || 0 })}
              />
            </div>
          </div>
          <div className="form-group">
            <label>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Definition</label>
            <textarea
              value={form.definition}
              onChange={(e) => setForm({ ...form, definition: e.target.value })}
              rows={5}
              required
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-group">
            <label>Formula (optional)</label>
            <textarea
              value={form.formula}
              onChange={(e) => setForm({ ...form, formula: e.target.value })}
              rows={3}
              placeholder="MOS (%) = (IV − Price) / IV × 100"
              style={{ width: '100%', fontFamily: 'monospace' }}
            />
          </div>
          <div className="form-group">
            <label>Example (optional)</label>
            <textarea
              value={form.example}
              onChange={(e) => setForm({ ...form, example: e.target.value })}
              rows={2}
              style={{ width: '100%' }}
            />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ flex: 1 }}>
              <label>Phase refs (comma-separated)</label>
              <input
                value={form.phaseRefs}
                onChange={(e) => setForm({ ...form, phaseRefs: e.target.value })}
                placeholder="3, 5"
              />
            </div>
            <div className="form-group" style={{ flex: 1 }}>
              <label>Related keys (comma-separated)</label>
              <input
                value={form.relatedKeys}
                onChange={(e) => setForm({ ...form, relatedKeys: e.target.value })}
                placeholder="mos, intrinsic_value"
              />
            </div>
          </div>
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Visible in CFA Reference
          </label>

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn" disabled={loading}>
              {loading ? 'Saving…' : 'Save term'}
            </button>
            {selectedKey && (
              <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void onDelete()}>
                Delete
              </button>
            )}
          </div>
        </form>
      </div>
    </Page>
  );
}
