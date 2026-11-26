import type { NoticeStatus, NoticeSummary } from '@yh/schema/constants';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Empty, ErrorState, FilterBar, StatusBadge, TypeBadge } from '../components/ui';
import { daysUntil, ddayLabel, todayKst } from '../lib/dates';
import { useFilter } from '../lib/filter';
import { fmtSchedule } from '../lib/format';

const TABS: { key: string; label: string; status: NoticeStatus[] }[] = [
  { key: 'active', label: '접수 중·예정', status: ['open', 'upcoming'] },
  { key: 'open', label: '접수 중', status: ['open'] },
  { key: 'upcoming', label: '접수 예정', status: ['upcoming'] },
  { key: 'closed', label: '마감', status: ['closed'] },
];

export function NoticeList() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find(t => t.key === params.get('tab')) ?? TABS[0]!;
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const f = useFilter();

  const [items, setItems] = useState<NoticeSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: Error | null }>({ loading: true, error: null });
  const [reload, setReload] = useState(0);

  const load = (after: string | null, signal?: AbortSignal) => {
    setState({ loading: true, error: null });
    return api.notices({ ...f.filter, status: tab.status, q: q || undefined, cursor: after ?? undefined }, signal).then(
      res => {
        setItems(prev => (after ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
        setState({ loading: false, error: null });
      },
      (error: Error) => { if (!signal?.aborted) setState({ loading: false, error }); },
    );
  };

  useEffect(() => {
    const ac = new AbortController();
    setItems([]);
    void load(null, ac.signal);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.key, q, f.key, reload]);

  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    setParams(p, { replace: true });
  };

  return (
    <main className="page">
      <header className="page-head">
        <h1>공고</h1>
      </header>
      <form className="search" role="search" onSubmit={e => { e.preventDefault(); setParam('q', draft.trim()); }}>
        <input
          type="search"
          placeholder="공고명으로 찾기 (예: 마포, 행복주택)"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          aria-label="공고 검색"
        />
      </form>
      <FilterBar f={f} />
      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.key} type="button" role="tab" aria-selected={t.key === tab.key} onClick={() => setParam('tab', t.key === 'active' ? '' : t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {state.error && items.length === 0 ? (
        <ErrorState error={state.error} onRetry={() => setReload(n => n + 1)} />
      ) : (
        <>
          <ul className="list">
            {items.map(n => <li key={n.id}><NoticeCard n={n} /></li>)}
          </ul>
          {!state.loading && items.length === 0 && (
            <Empty>{q ? `'${q}'에 맞는 공고가 없어요.` : '조건에 맞는 공고가 없어요.'}</Empty>
          )}
          {state.loading && <div className="state" aria-busy="true">불러오는 중…</div>}
          {!state.loading && cursor && (
            <button type="button" className="btn btn-secondary btn-block" onClick={() => void load(cursor)}>더 보기</button>
          )}
        </>
      )}
    </main>
  );
}

function NoticeCard({ n }: { n: NoticeSummary }) {
  const today = todayKst();
  const target = n.status === 'open' ? n.applyEnd : n.status === 'upcoming' ? n.applyStart : null;
  const dday = target ? daysUntil(target.startDate, today) : null;
  return (
    <Link to={`/notices/${n.id}`} className="list-item">
      <div className="row">
        <StatusBadge status={n.status}>{dday !== null && dday >= 0 ? ` ${ddayLabel(dday)}` : ''}</StatusBadge>
        <TypeBadge type={n.housingType} />
      </div>
      <p className="title">{n.title}</p>
      <p className="muted small">
        {[n.regionNames.join(', '), n.sourceName].filter(Boolean).join(' · ')}
      </p>
      {(n.applyStart || n.applyEnd) && (
        <p className="small">
          접수 {n.applyStart ? fmtSchedule(n.applyStart) : ''}
          {n.applyEnd && n.applyEnd.startDate !== n.applyStart?.startDate ? ` ~ ${fmtSchedule(n.applyEnd)}` : ''}
        </p>
      )}
    </Link>
  );
}
