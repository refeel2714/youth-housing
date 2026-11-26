// 30초 진단 결과: 접수 중·예정 공고를 지원 가능 / 확인 필요 / 정리 중 / 어려움으로 나눠 보여 준다.
import { ASSET_BANDS, CAR_BANDS, findBand, INCOME_BANDS, isAutoRule, keyReasons, type NoticeVerdict, type Profile } from '@yh/eligibility';
import { TARGET_GROUP_LABELS, type RegionView } from '@yh/schema/constants';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Empty, ErrorState, Loading, StatusBadge, TypeBadge, VerdictBadge } from '../components/ui';
import { daysUntil, ddayLabel, todayKst } from '../lib/dates';
import { useFilter } from '../lib/filter';
import { fmtSchedule } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { clearProfile, missingFields, OUTSIDE_METRO } from '../profile/store';
import { useEligibility, type Judged } from '../profile/useEligibility';

const SECTIONS: { result: NoticeVerdict; title: string; desc?: string }[] = [
  { result: 'pass', title: '지원 가능' },
  { result: 'unknown', title: '확인 필요', desc: '조건을 더 넣거나 공고 원문에서 확인해야 해요.' },
  { result: 'none', title: '자격 정리 중', desc: '아직 자격 요건을 옮기지 못한 공고예요. 원문을 확인해 주세요.' },
  { result: 'fail', title: '지원 어려움' },
];

export function DiagnoseResult() {
  const el = useEligibility();
  const nav = useNavigate();
  const f = useFilter();
  if (el.status === 'no-profile') return <Navigate to="/diagnose" replace />;

  const active = el.status === 'ok'
    ? [...el.map.values()].filter(j => j.notice.status === 'open' || j.notice.status === 'upcoming')
    : [];
  const by = (r: NoticeVerdict) => active.filter(j => j.judgement.result === r);
  const missing = missingFields(el.profile);

  return (
    <main className="page diagnose-result">
      <header className="page-head">
        <h1>내 자격 진단</h1>
        <Link to="/diagnose" className="head-link">조건 수정</Link>
      </header>

      <ProfileSummary p={el.profile} />
      {missing.length > 0 && (
        <p className="notice-box small">
          {missing.join(', ')}을(를) 넣으면 ‘확인 필요’가 줄어요. <Link to="/diagnose">넣으러 가기</Link>
        </p>
      )}

      {el.status === 'loading' && <Loading />}
      {el.status === 'error' && <ErrorState error={el.error} onRetry={el.retry} />}
      {el.status === 'ok' && (
        <>
          <section className="card summary" aria-label="요약">
            <p className="summary-main">
              접수 중·예정 공고 {active.length}건 중 <strong>{by('pass').length}건</strong> 지원 가능해요
            </p>
            <div className="summary-counts">
              {SECTIONS.map(s => (
                <a key={s.result} href={`#v-${s.result}`}><VerdictBadge result={s.result} /> {by(s.result).length}</a>
              ))}
            </div>
            <button type="button" className="btn btn-primary btn-block" onClick={() => { f.setMine(true); nav('/'); }}>
              내 조건으로 캘린더 보기
            </button>
          </section>

          {active.length === 0 && <Empty>지금 접수 중이거나 예정인 공고가 없어요.</Empty>}
          {SECTIONS.map(s => {
            const items = by(s.result);
            if (items.length === 0) return null;
            const list = <ul className="list">{items.map(j => <li key={j.notice.id}><ResultCard j={j} /></li>)}</ul>;
            return (
              <section key={s.result} id={`v-${s.result}`} className="result-section">
                {s.result === 'fail' ? (
                  <details>
                    <summary><h2>{s.title} {items.length}</h2></summary>
                    {list}
                  </details>
                ) : (
                  <>
                    <h2>{s.title} {items.length}</h2>
                    {s.desc && <p className="muted small">{s.desc}</p>}
                    {list}
                  </>
                )}
              </section>
            );
          })}

          <p className="muted small disclaimer">
            공고문에서 옮긴 요건과 입력한 구간으로 판단한 결과예요. 일부 공고는 요건을 본문에서 자동으로 정리해 틀릴 수 있어요.
            실제 자격은 신청 기관 심사로 정해지니 원문을 꼭 확인해 주세요.
          </p>
          <button type="button" className="text-btn" onClick={() => { clearProfile(); f.setMine(false); }}>
            이 기기에 저장된 조건 지우기
          </button>
        </>
      )}
    </main>
  );
}

function ResultCard({ j }: { j: Judged }) {
  const { notice: n, judgement } = j;
  const today = todayKst();
  const target = n.status === 'open' ? n.applyEnd : n.applyStart;
  const dday = target ? daysUntil(target.startDate, today) : null;
  const best = judgement.rules[0];
  const passGroups = judgement.rules.filter(r => r.result === 'pass')
    .map(r => `${TARGET_GROUP_LABELS[r.rule.targetGroup]}${r.rule.variant ? ` ${r.rule.variant}` : ''}`);
  const reasons = best && judgement.result !== 'pass' ? keyReasons(best).slice(0, 2) : [];
  // 판정에 쓴 규칙이 운영자 검수 전(본문에서 자동 정리)이면 알린다
  const auto = best !== undefined && judgement.result !== 'fail' && isAutoRule(best.rule);

  return (
    <Link to={`/notices/${n.id}`} className="list-item">
      <div className="row">
        <VerdictBadge result={judgement.result} />
        <StatusBadge status={n.status}>{dday !== null && dday >= 0 ? ` ${ddayLabel(dday)}` : ''}</StatusBadge>
        <TypeBadge type={n.housingType} />
      </div>
      <p className="title">{n.title}</p>
      {target && <p className="small muted">{n.status === 'open' ? '마감' : '접수 시작'} {fmtSchedule(target)}</p>}
      {passGroups.length > 0 && <p className="small">{passGroups.join(', ')} 유형으로 지원할 수 있어요</p>}
      {reasons.length > 0 && (
        <ul className="reasons">{reasons.map(r => <li key={r}>{r}</li>)}</ul>
      )}
      {auto && <p className="small muted">공고 본문에서 자동 정리한 조건 기준이에요</p>}
    </Link>
  );
}

function ProfileSummary({ p }: { p: Profile }) {
  const regions = useAsync(s => api.regions(s), []);
  const region = regionLabel(p.regionCode, regions.data?.items ?? []);
  const parts = [
    p.birthYear && `${p.birthYear}년${p.birthMonth ? ` ${p.birthMonth}월` : ''}생`,
    region,
    p.homelessScope && { household: '세대 무주택', self: '본인 무주택', none: '주택 보유' }[p.homelessScope],
    p.householdSize && `${p.householdSize}인 가구`,
    findBand(INCOME_BANDS, p.incomeBand) && `연소득 ${findBand(INCOME_BANDS, p.incomeBand)!.label}`,
    findBand(ASSET_BANDS, p.assetBand) && `자산 ${findBand(ASSET_BANDS, p.assetBand)!.label}`,
    findBand(CAR_BANDS, p.carBand) && (p.carBand === 'c0' ? '차량 없음' : `차량 ${findBand(CAR_BANDS, p.carBand)!.label}`),
    p.isMarried !== undefined && (p.isMarried ? '기혼' : '미혼'),
    p.isStudent && '학생',
  ].filter(Boolean) as string[];
  return (
    <ul className="profile-chips" aria-label="내 조건">
      {parts.map(x => <li key={x}>{x}</li>)}
    </ul>
  );
}

function regionLabel(code: string | undefined, regions: RegionView[]): string | undefined {
  if (!code) return undefined;
  if (code === OUTSIDE_METRO) return '수도권 외';
  const r = regions.find(x => x.code === code);
  return r ? (r.sigungu ? `${r.sido} ${r.sigungu}` : r.sido) : undefined;
}
