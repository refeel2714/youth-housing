import { platform } from '@platform';
import {
  HOUSING_TYPE_LABELS, NOTICE_STATUS_LABELS, SCHEDULE_KIND_LABELS,
  type HousingType, type NoticeStatus, type ScheduleKind,
} from '@yh/schema/constants';
import type { NoticeVerdict } from '@yh/eligibility';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SIDO_OPTIONS, TYPE_CHIPS, type useFilter } from '../lib/filter';
import { useProfile } from '../profile/store';

export function KindDot({ kind }: { kind: ScheduleKind }) {
  return <span className={`dot kind-${kind}`} aria-hidden />;
}

export function KindLabel({ kind, seq = 1 }: { kind: ScheduleKind; seq?: number }) {
  return (
    <span className={`kind-label kind-${kind}`}>
      {SCHEDULE_KIND_LABELS[kind]}{seq > 1 ? ` ${seq}차` : ''}
    </span>
  );
}

export function StatusBadge({ status, children }: { status: NoticeStatus; children?: ReactNode }) {
  return <span className={`badge status-${status}`}>{NOTICE_STATUS_LABELS[status]}{children}</span>;
}

export function TypeBadge({ type }: { type: HousingType }) {
  return <span className="badge type">{HOUSING_TYPE_LABELS[type]}</span>;
}

export function FilterBar({ f }: { f: ReturnType<typeof useFilter> }) {
  return (
    <div className="filters">
      <div className="segmented" role="group" aria-label="지역">
        {SIDO_OPTIONS.map(o => (
          <button key={o.code} type="button" aria-pressed={f.sido === o.code} onClick={() => f.setSido(o.code)}>
            {o.label}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="주택 유형">
        <MineChip f={f} />
        {TYPE_CHIPS.map(c => (
          <button key={c.label} type="button" className="chip" aria-pressed={f.hasTypes(c.types)} onClick={() => f.toggleTypes(c.types)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 30초 진단을 했으면 '내 조건 맞춤' 켜고 끄기, 안 했으면 진단으로 가는 칩 */
function MineChip({ f }: { f: ReturnType<typeof useFilter> }) {
  const profile = useProfile();
  if (!profile) return <Link to="/diagnose" className="chip chip-cta">30초 자격 진단</Link>;
  return (
    <button type="button" className="chip chip-mine" aria-pressed={f.mine} onClick={() => f.setMine(!f.mine)}>
      {f.mine ? '✓ ' : ''}내 조건 맞춤
    </button>
  );
}

export const VERDICT_LABELS: Record<NoticeVerdict, string> = {
  pass: '지원 가능',
  unknown: '확인 필요',
  fail: '지원 어려움',
  none: '자격 정리 중',
};

export function VerdictBadge({ result }: { result: NoticeVerdict }) {
  return <span className={`badge verdict-${result}`}>{VERDICT_LABELS[result]}</span>;
}

export function ExternalButton({ href, primary, children }: { href: string; primary?: boolean; children: ReactNode }) {
  return (
    <a
      className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => { e.preventDefault(); platform.openExternal(href); }}
    >
      {children}
    </a>
  );
}

export function BackButton() {
  const nav = useNavigate();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="뒤로"
      onClick={() => (window.history.state?.idx > 0 ? nav(-1) : nav('/notices'))}
    >
      ‹
    </button>
  );
}

export function Loading() {
  return <div className="state" aria-busy="true">불러오는 중…</div>;
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state">
      <p>{error.message}</p>
      {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>다시 시도</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="state muted">{children}</div>;
}
