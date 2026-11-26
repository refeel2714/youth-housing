// 관심: 관심 공고, 관심 지역, 캘린더 구독. 전부 이 기기에 저장되고 로그인은 필요 없다.
import type { NoticeSummary, RegionView } from '@yh/schema/constants';
import { useMemo, useState } from 'react';
import { platform } from '@platform';
import { api } from '../api/client';
import { Empty, ErrorState, Loading } from '../components/ui';
import { SIDO_OPTIONS } from '../lib/filter';
import { useAsync } from '../lib/useAsync';
import {
  ALARM_OPTIONS, feedLinks, removeNotice, subscribe, toggleAlarm, toggleRegion, unsubscribe, useWatch,
  type WatchState,
} from '../watch/store';
import { NoticeCard } from './NoticeList';

const regionsCache: { p?: Promise<{ items: RegionView[] }> } = {};
const loadRegions = () => (regionsCache.p ??= api.regions().catch(e => { regionsCache.p = undefined; throw e; }));

export function Watch() {
  const w = useWatch();
  return (
    <main className="page">
      <header className="page-head">
        <h1>관심</h1>
      </header>
      <p className="muted small lead">관심 공고와 관심 지역은 이 기기에만 저장돼요.</p>
      <WatchedNotices w={w} />
      <WatchedRegions w={w} />
      <Subscribe w={w} />
    </main>
  );
}

function WatchedNotices({ w }: { w: WatchState }) {
  const ids = w.notices.map(n => n.id);
  const key = ids.join(',');
  const res = useAsync(
    s => (ids.length ? api.notices({ regions: [], types: [], status: [], ids, limit: 50 }, s) : Promise.resolve({ items: [], nextCursor: null })),
    [key],
  );
  // 서버 목록 순서(접수 중 → 예정 → 마감)를 따르고, 내려가서 안 오는 공고는 저장된 제목으로 아래에 둔다
  const found = new Set(res.data?.items.map(n => n.id));
  const gone = res.status === 'ok' ? w.notices.filter(n => !found.has(n.id)) : [];

  return (
    <section className="result-section" aria-labelledby="w-notices">
      <h2 id="w-notices">관심 공고{w.notices.length ? ` ${w.notices.length}` : ''}</h2>
      {w.notices.length === 0 ? (
        <Empty>공고 상세에서 ☆ 관심을 누르면 여기에 모여요.</Empty>
      ) : res.status === 'loading' ? <Loading />
        : res.status === 'error' ? <ErrorState error={res.error} onRetry={res.reload} />
        : (
          <ul className="list">
            {res.data.items.map((n: NoticeSummary) => <li key={n.id}><NoticeCard n={n} /></li>)}
            {gone.map(n => (
              <li key={n.id} className="list-item gone">
                <p className="title">{n.title}</p>
                <p className="muted small">
                  더 볼 수 없는 공고예요.{' '}
                  <button type="button" className="text-btn inline" onClick={() => removeNotice(n.id)}>목록에서 지우기</button>
                </p>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function WatchedRegions({ w }: { w: WatchState }) {
  const [open, setOpen] = useState(false);
  const regions = useAsync(() => loadRegions(), []);
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of regions.data?.items ?? []) m.set(r.code, r.sigungu ? `${shortSido(r.sido)} ${r.sigungu}` : `${shortSido(r.sido)} 전체`);
    return m;
  }, [regions.data]);

  const listed = useAsync(
    s => (w.regions.length
      ? api.notices({ regions: w.regions, types: [], status: ['open', 'upcoming'], limit: 20 }, s)
      : Promise.resolve({ items: [], nextCursor: null })),
    [w.regions.join(',')],
  );

  return (
    <section className="result-section" aria-labelledby="w-regions">
      <div className="section-head">
        <h2 id="w-regions">관심 지역</h2>
        <button type="button" className="head-link" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? '닫기' : w.regions.length ? '바꾸기' : '고르기'}
        </button>
      </div>
      <p className="muted small">관심 지역에 새 공고가 올라오면 접수 일정이 캘린더 구독에 같이 들어가요.</p>
      {w.regions.length > 0 && !open && (
        <ul className="profile-chips">
          {w.regions.map(c => <li key={c}>{names.get(c) ?? c}</li>)}
        </ul>
      )}
      {open && (regions.status === 'ok' ? <RegionPicker all={regions.data.items} selected={w.regions} />
        : regions.status === 'error' ? <ErrorState error={regions.error} onRetry={regions.reload} /> : <Loading />)}

      {w.regions.length > 0 && !open && (
        listed.status === 'loading' ? <Loading />
        : listed.status === 'error' ? <ErrorState error={listed.error} onRetry={listed.reload} />
        : listed.data.items.length === 0 ? <Empty>지금은 이 지역에 접수 중이거나 예정인 공고가 없어요.</Empty>
        : (
          <ul className="list">
            {listed.data.items.map(n => <li key={n.id}><NoticeCard n={n} /></li>)}
          </ul>
        )
      )}
    </section>
  );
}

const shortSido = (s: string) => SIDO_OPTIONS.find(o => o.code && s.startsWith(o.label))?.label ?? s;

function RegionPicker({ all, selected }: { all: RegionView[]; selected: string[] }) {
  const [sido, setSido] = useState<string>(SIDO_OPTIONS[1]!.code);
  const prefix = sido.slice(0, 2);
  // 구가 있는 시는 시 단위로만 보여 준다(공고에 시 코드도 같이 붙어 있음)
  const children = all.filter(r => r.code.startsWith(prefix) && r.sigungu && !r.sigungu.includes(' '));
  const sidoOn = selected.includes(sido);
  return (
    <div className="region-picker">
      <div className="segmented" role="group" aria-label="시도">
        {SIDO_OPTIONS.filter(o => o.code).map(o => {
          const n = selected.filter(c => c.startsWith(o.code.slice(0, 2))).length;
          return (
            <button key={o.code} type="button" aria-pressed={sido === o.code} onClick={() => setSido(o.code)}>
              {o.label}{n ? ` ${n}` : ''}
            </button>
          );
        })}
      </div>
      <div className="chips wrap" role="group" aria-label="시군구">
        <button type="button" className="chip" aria-pressed={sidoOn} onClick={() => toggleRegion(sido)}>
          {sidoOn ? '✓ ' : ''}전체
        </button>
        {children.map(r => (
          <button key={r.code} type="button" className="chip" aria-pressed={selected.includes(r.code)} disabled={sidoOn} onClick={() => toggleRegion(r.code)}>
            {r.sigungu}
          </button>
        ))}
      </div>
    </div>
  );
}

function Subscribe({ w }: { w: WatchState }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const empty = w.notices.length === 0 && w.regions.length === 0;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '잠시 뒤에 다시 해 주세요'); } finally { setBusy(false); }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('주소를 복사해 주세요', text);
    }
  };

  return (
    <section className="result-section" aria-labelledby="w-feed">
      <h2 id="w-feed">캘린더로 일정 받기</h2>
      <p className="muted small">
        관심 공고의 모든 일정과 관심 지역 공고의 접수 시작·마감이 내 캘린더에 들어가요. 관심 목록을 바꾸면 캘린더에도 반영돼요.
      </p>

      <fieldset className="field compact">
        <legend>캘린더 알림 <span className="muted small">(오전 9시, 최대 3개)</span></legend>
        <div className="chips wrap">
          {ALARM_OPTIONS.map(o => (
            <button key={o.days} type="button" className="chip" aria-pressed={w.alarmDays.includes(o.days)} onClick={() => toggleAlarm(o.days)}>
              {o.label}
            </button>
          ))}
        </div>
        <p className="muted small hint">접수 시작·마감, 서류 제출, 계약 일정에 알림이 걸려요. 구글 캘린더는 구독한 캘린더의 알림을 따로 켜야 해요.</p>
      </fieldset>

      {!w.feed ? (
        <button type="button" className="btn btn-primary btn-block" disabled={busy || empty} onClick={() => void run(subscribe)}>
          {empty ? '관심 공고나 지역을 먼저 골라 주세요' : busy ? '만드는 중…' : '내 캘린더에 추가하기'}
        </button>
      ) : (
        <FeedButtons url={w.feed.url} onCopy={copy} copied={copied} />
      )}
      {error && <p className="small error">{error}</p>}
      {w.feed && (
        <p className="muted small">
          {w.dirty ? '바뀐 관심 목록을 구독에 올리는 중이에요. ' : ''}
          캘린더 앱이 몇 시간마다 새로 받아 가요.{' '}
          <button type="button" className="text-btn inline" disabled={busy} onClick={() => void run(unsubscribe)}>구독 끊기</button>
        </p>
      )}
    </section>
  );
}

function FeedButtons({ url, onCopy, copied }: { url: string; onCopy: (s: string) => void; copied: boolean }) {
  const links = feedLinks(url);
  return (
    <div className="feed-buttons">
      <a className="btn btn-primary" href={links.webcal}>아이폰·맥 캘린더에 추가</a>
      <a className="btn btn-secondary" href={links.google} target="_blank" rel="noopener noreferrer"
        onClick={e => { e.preventDefault(); platform.openExternal(links.google); }}>
        구글 캘린더에 추가
      </a>
      <button type="button" className="btn btn-secondary" onClick={() => onCopy(links.https)}>
        {copied ? '복사했어요' : '구독 주소 복사'}
      </button>
      <p className="muted small">주소를 아는 사람은 이 일정을 볼 수 있어요. 다른 사람과 나누지 마세요.</p>
    </div>
  );
}
