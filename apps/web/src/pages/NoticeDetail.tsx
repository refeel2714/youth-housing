import {
  TARGET_GROUP_LABELS, type EligibilityRule, type NoticeDetail as Detail, type NoticeUnitView,
} from '@yh/schema/constants';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { BackButton, Empty, ErrorState, ExternalButton, KindLabel, Loading, StatusBadge, TypeBadge } from '../components/ui';
import { daysUntil, ddayLabel, fmtDate, todayKst } from '../lib/dates';
import { fmtSchedule, fmtWon } from '../lib/format';
import { useAsync } from '../lib/useAsync';

export function NoticeDetail() {
  const { id = '' } = useParams();
  const res = useAsync(s => api.notice(id, s), [id]);

  return (
    <main className="page detail">
      <header className="page-head with-back">
        <BackButton />
        <h1 className="sr-only">공고 상세</h1>
      </header>
      {res.status === 'loading' && <Loading />}
      {res.status === 'error' && (
        res.error instanceof ApiError && res.error.status === 404
          ? <Empty>공고를 찾을 수 없어요. 삭제됐거나 아직 확인 중인 공고일 수 있어요.</Empty>
          : <ErrorState error={res.error} onRetry={res.reload} />
      )}
      {res.status === 'ok' && <Body d={res.data} />}
    </main>
  );
}

function Body({ d }: { d: Detail }) {
  const today = todayKst();
  const target = d.status === 'open' ? d.applyEnd : d.status === 'upcoming' ? d.applyStart : null;
  const dday = target ? daysUntil(target.startDate, today) : null;

  return (
    <>
      <section className="detail-head">
        <div className="row">
          <StatusBadge status={d.status}>{dday !== null && dday >= 0 ? ` ${ddayLabel(dday)}` : ''}</StatusBadge>
          <TypeBadge type={d.housingType} />
        </div>
        <h2 className="detail-title">{d.title}</h2>
        <p className="muted small">
          {[d.regionNames.join(', '), d.sourceName, d.publishedAt && `${fmtDate(d.publishedAt, true)} 공고`].filter(Boolean).join(' · ')}
        </p>
      </section>

      <div className="cta">
        {d.urlApply && d.status !== 'closed' && d.status !== 'cancelled' && (
          <ExternalButton href={d.urlApply} primary>신청하러 가기</ExternalButton>
        )}
        <ExternalButton href={d.urlOriginal} primary={!d.urlApply || d.status === 'closed'}>공고 원문 보기</ExternalButton>
      </div>

      <section className="card">
        <h3>일정</h3>
        {d.schedules.length === 0 ? <Empty>아직 정리된 일정이 없어요. 공고 원문을 확인해 주세요.</Empty> : (
          <ol className="timeline">
            {d.schedules.map(s => {
              const past = s.endDate < today;
              return (
                <li key={s.id} className={`kind-${s.kind} ${past ? 'past' : s.startDate <= today ? 'now' : ''}`}>
                  <KindLabel kind={s.kind} seq={s.seq} />
                  <span className="when">{fmtSchedule(s)}</span>
                  {s.note && <span className="muted small note">{s.note}</span>}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {d.units.length > 0 && (
        <section className="card">
          <h3>공급 세대</h3>
          <Units units={d.units} />
        </section>
      )}

      {d.rules.length > 0 && (
        <section className="card">
          <h3>신청 자격(요약)</h3>
          {d.rules.map(r => <Rule key={`${r.targetGroup}-${r.variant}`} r={r} />)}
          <p className="muted small">내 조건으로 자격을 확인하는 기능은 곧 추가돼요.</p>
        </section>
      )}

      <p className="muted small disclaimer">
        일정과 자격은 공고문에서 옮긴 내용이에요. 신청 전에 꼭 공고 원문을 확인해 주세요.
      </p>
    </>
  );
}

function Units({ units }: { units: NoticeUnitView[] }) {
  const groups = new Map<string, NoticeUnitView[]>();
  for (const u of units) {
    const k = u.complex?.name ?? '단지 미정';
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  return (
    <>
      {[...groups].map(([name, us]) => (
        <div key={name} className="units">
          <p className="unit-complex">
            {name}
            {us[0]?.complex?.nearestStation && <span className="muted small"> · {us[0].complex.nearestStation}</span>}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>대상</th><th>주택형</th><th>보증금</th><th>월 임대료</th><th>세대</th></tr>
              </thead>
              <tbody>
                {us.map(u => (
                  <tr key={u.id}>
                    <td>{TARGET_GROUP_LABELS[u.targetGroup]}</td>
                    <td>{u.unitType ?? '-'}{u.areaM2 ? <span className="muted"> {u.areaM2}㎡</span> : null}</td>
                    <td>{fmtWon(u.deposit)}</td>
                    <td>{fmtWon(u.monthlyRent)}</td>
                    <td>{u.supplyCount ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

function Rule({ r }: { r: EligibilityRule }) {
  const lines: [string, string][] = [];
  if (r.ageMin !== null || r.ageMax !== null) {
    lines.push(['나이', `만 ${r.ageMin ?? ''}~${r.ageMax ?? ''}세${r.ageRefDate ? ` (${fmtDate(r.ageRefDate, true)} 기준)` : ''}`]);
  }
  if (r.homelessScope && r.homelessScope !== 'none') {
    lines.push(['무주택', r.homelessScope === 'household' ? '세대 구성원 전원 무주택' : '본인 무주택']);
  }
  if (r.incomeBasis && r.incomePctByHousehold) {
    const pcts = [...new Set(Object.values(r.incomePctByHousehold))];
    const basis = r.incomeBasis === 'median' ? '기준 중위소득' : '도시근로자 월평균소득';
    lines.push(['소득', pcts.length === 1 ? `${basis} ${pcts[0]}% 이하` : `${basis} 가구원수별 ${Math.min(...pcts)}~${Math.max(...pcts)}% 이하`]);
  }
  if (r.assetMax !== null) lines.push(['총자산', `${fmtWon(r.assetMax)} 이하`]);
  if (r.carValueMax !== null) lines.push(['자동차', `${fmtWon(r.carValueMax)} 이하`]);
  const extra = [
    r.extra.unmarriedOnly && '미혼', r.extra.marriedOnly && '기혼', r.extra.studentOnly && '대학생·취업준비생',
    r.extra.householderOnly && '세대주',
  ].filter(Boolean);
  if (extra.length) lines.push(['기타', extra.join(', ')]);

  return (
    <div className="rule">
      <p className="rule-group">{TARGET_GROUP_LABELS[r.targetGroup]}{r.variant ? ` · ${r.variant}` : ''}</p>
      <dl>
        {lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </div>
  );
}
