import type { CalendarItem } from '@yh/schema/constants';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Empty, ErrorState, FilterBar, KindDot, KindLabel, StatusBadge } from '../components/ui';
import { addMonths, eachDate, fmtDate, fmtMonth, isMonth, monthGrid, todayKst } from '../lib/dates';
import { useFilter } from '../lib/filter';
import { fmtSchedule } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_DOTS = 3;

export function Calendar() {
  const today = todayKst();
  const [params, setParams] = useSearchParams();
  const month = isMonth(params.get('month')) ? params.get('month')! : today.slice(0, 7);
  const f = useFilter();
  const res = useAsync(s => api.calendar(month, f.filter, s), [month, f.key]);

  // 날짜별 일정. 여러 날 일정(서류 제출 기간 등)은 걸친 날마다 넣는다
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of res.data?.items ?? []) {
      for (const d of eachDate(it.startDate, it.endDate)) {
        if (!d.startsWith(month)) continue;
        m.set(d, [...(m.get(d) ?? []), it]);
      }
    }
    return m;
  }, [res.data, month]);

  const selectedParam = params.get('date');
  const selected =
    selectedParam?.startsWith(month) ? selectedParam
    : today.startsWith(month) ? today
    : [...byDate.keys()].sort()[0] ?? `${month}-01`;

  const go = (next: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) (v === null ? p.delete(k) : p.set(k, v));
    setParams(p, { replace: true });
  };
  const moveMonth = (n: number) => go({ month: addMonths(month, n), date: null });

  return (
    <main className="page">
      <header className="page-head">
        <h1>청년주택 일정</h1>
      </header>
      <FilterBar f={f} />

      <section className="card calendar" aria-label={`${fmtMonth(month)} 달력`}>
        <div className="cal-nav">
          <button type="button" className="icon-btn" aria-label="이전 달" onClick={() => moveMonth(-1)}>‹</button>
          <h2>{fmtMonth(month)}</h2>
          <button type="button" className="icon-btn" aria-label="다음 달" onClick={() => moveMonth(1)}>›</button>
          {!today.startsWith(month) && (
            <button type="button" className="today-btn" onClick={() => go({ month: today.slice(0, 7), date: null })}>오늘</button>
          )}
        </div>
        <div className="cal-grid" role="grid">
          {WEEK.map((w, i) => <div key={w} className={`cal-wd wd-${i}`} role="columnheader">{w}</div>)}
          {monthGrid(month).flat().map(({ date, inMonth }, i) => {
            const items = byDate.get(date) ?? [];
            const kinds = [...new Set(items.map(it => it.kind))];
            return (
              <button
                key={date}
                type="button"
                role="gridcell"
                className={`cal-cell wd-${i % 7}${inMonth ? '' : ' out'}${date === today ? ' today' : ''}`}
                aria-selected={date === selected}
                aria-label={`${fmtDate(date)} 일정 ${items.length}개`}
                disabled={!inMonth}
                onClick={() => go({ date })}
              >
                <span className="cal-day">{Number(date.slice(8))}</span>
                <span className="cal-dots">
                  {kinds.slice(0, MAX_DOTS).map(k => <KindDot key={k} kind={k} />)}
                  {kinds.length > MAX_DOTS && <span className="more">+</span>}
                </span>
              </button>
            );
          })}
        </div>
        <Legend />
      </section>

      <section className="day-list" aria-live="polite">
        <h2>{fmtDate(selected)}{selected === today ? ' · 오늘' : ''}</h2>
        {res.status === 'loading' && <div className="state" aria-busy="true">불러오는 중…</div>}
        {res.status === 'error' && <ErrorState error={res.error} onRetry={res.reload} />}
        {res.status === 'ok' && <DayItems items={byDate.get(selected) ?? []} monthEmpty={res.data.items.length === 0} />}
      </section>
    </main>
  );
}

function DayItems({ items, monthEmpty }: { items: CalendarItem[]; monthEmpty: boolean }) {
  if (monthEmpty) return <Empty>이 달에는 조건에 맞는 일정이 없어요.</Empty>;
  if (items.length === 0) return <Empty>이 날은 일정이 없어요. 점이 있는 날을 눌러 보세요.</Empty>;
  return (
    <ul className="list">
      {items.map(it => (
        <li key={it.scheduleId}>
          <Link to={`/notices/${it.noticeId}`} className="list-item">
            <div className="row">
              <KindLabel kind={it.kind} seq={it.seq} />
              <span className="when">{fmtSchedule(it)}</span>
            </div>
            <p className="title">{it.title}</p>
            <div className="row">
              <StatusBadge status={it.status} />
              {it.note && <span className="muted small">{it.note}</span>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Legend() {
  const kinds = ['apply_start', 'apply_end', 'doc_submit', 'winner', 'contract', 'announce'] as const;
  return (
    <ul className="legend" aria-label="범례">
      {kinds.map(k => <li key={k}><KindLabel kind={k} /></li>)}
    </ul>
  );
}
