import type { NoticeStatus, NoticeSummary } from '@yh/schema/constants';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { NoticeVerdict } from '@yh/eligibility';
import { Empty, ErrorState, FilterBar, StatusBadge, TypeBadge, VerdictBadge } from '../components/ui';
import { daysUntil, ddayLabel, todayKst } from '../lib/dates';
import { useFilter } from '../lib/filter';
import { fmtSchedule } from '../lib/format';
import { hiddenByMine, useEligibility } from '../profile/useEligibility';

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
  const el = useEligibility();
  const verdicts = el.status === 'ok' ? el.map : null;
  const mineOn = f.mine && el.status !== 'no-profile';

  const [items, setItems] = useState<NoticeSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<{ loading: boolean; error: Error | null }>({ loading: true, error: null });
  const [reload, setReload] = useState(0);

  const load = (after: string | null, signal?: AbortSignal) => {
    setState({ loading: true, error: null });
    // 맞춤 필터는 화면에서 거르므로 한 번에 더 많이 받는다
    const limit = mineOn ? 50 : undefined;
    return api.notices({ ...f.filter, status: tab.status, q: q || undefined, cursor: after ?? undefined, limit }, signal).then(
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
  }, [tab.key, q, f.key, mineOn, reload]);

  const shown = mineOn ? items.filter(n => !hiddenByMine(verdicts, n.id)) : items;
  const hiddenCount = items.length - shown.length;
  // 받은 페이지가 전부 걸러졌으면 다음 페이지를 이어서 받는다
  useEffect(() => {
    if (mineOn && !state.loading && !state.error && shown.length === 0 && cursor) void load(cursor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineOn, state.loading, state.error, shown.length, cursor]);

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
            {shown.map(n => <li key={n.id}><NoticeCard n={n} verdict={verdicts?.get(n.id)?.judgement.result} /></li>)}
          </ul>
          {!state.loading && shown.length === 0 && (
            <Empty>{q ? `'${q}'에 맞는 공고가 없어요.` : mineOn ? '내 조건으로 지원할 수 있는 공고가 없어요.' : '조건에 맞는 공고가 없어요.'}</Empty>
          )}
          {mineOn && hiddenCount > 0 && !state.loading && (
            <p className="muted small center">
              지원이 어려운 공고 {hiddenCount}건은 숨겼어요.{' '}
              <button type="button" className="text-btn inline" onClick={() => f.setMine(false)}>모두 보기</button>
            </p>
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

function NoticeCard({ n, verdict }: { n: NoticeSummary; verdict?: NoticeVerdict }) {
  const today = todayKst();
  const target = n.status === 'open' ? n.applyEnd : n.status === 'upcoming' ? n.applyStart : null;
  const dday = target ? daysUntil(target.startDate, today) : null;
  return (
    <Link to={`/notices/${n.id}`} className="list-item">
      <div className="row">
        {verdict && <VerdictBadge result={verdict} />}
        <StatusBadge status={n.status}>{dday !== null && dday >= 0 ? ` ${ddayLabel(dday)}` : ''}</StatusBadge>
        <TypeBadge type={n.housingType} />
      </div>
      <p className="title">{n.title}</p>
      <p className="muted small">
        {[n.regionNames.join(', '), n.sourceName, !n.verified && '자동 수집'].filter(Boolean).join(' · ')}
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
