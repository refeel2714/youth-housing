// 공고 본문의 "■ 라벨 : 날짜 ~ 날짜" 줄에서 일정을 뽑는다(규칙 기반).
// 확신이 없는 줄은 버린다. 빠진 일정은 LLM 파싱·검수 단계에서 채운다.
import type { ScheduleKind } from '@yh/schema';
import { findDate, type KstDateTime } from './dates.js';

export interface ExtractedSchedule {
  kind: ScheduleKind;
  start: KstDateTime;
  end: KstDateTime | null;
  label: string;
}

const LINE = /^[\s■□▶▷◆◇●○•·※\-*]*([^:：]{2,40}?)\s*[:：]\s*(.+)$/;

const RULES: [RegExp, ScheduleKind | 'apply'][] = [
  [/당첨자\s*발표|최종\s*(?:당첨|합격)|입주자\s*발표|예비\s*입주자\s*발표/, 'winner'],
  [/계약/, 'contract'],
  [/서류.*(?:제출|접수)|제출\s*기간/, 'doc_submit'],
  [/발표/, 'doc_result'],
  [/공고/, 'announce'],
  [/입주\s*(?:기간|일|예정|지정)/, 'move_in'],
  [/청약|접수|신청/, 'apply'],
];

/** 날짜가 들어 있어도 일정이 아닌 줄(자격 기준일, 문의처 등) */
const NOT_SCHEDULE = /자격|대상\s*(?:자\s*)?요건|기준|방법|문의|페이지|장소|주소|위치|호수|세대/;

function classify(label: string): ScheduleKind | 'apply' | null {
  if (NOT_SCHEDULE.test(label)) return null;
  for (const [re, kind] of RULES) if (re.test(label)) return kind;
  return null;
}

/** "~ 17:00" 처럼 날짜 없이 시각만 있는 끝을 같은 날로 본다 */
function parseRange(value: string): { start: KstDateTime; end: KstDateTime | null } | null {
  const first = findDate(value);
  if (!first) return null;
  const rest = value.slice(first.end);
  const tilde = /^\s*(?:\([^)]*\))?\s*[~∼〜\-–]\s*/.exec(rest);
  if (!tilde) return { start: first.value, end: null };
  const after = rest.slice(tilde[0].length);
  const second = findDate(after);
  if (second && second.end - (after.length - after.trimStart().length) < 40) {
    return { start: first.value, end: second.value };
  }
  const t = /^(?:\([^)]*\)\s*)?(\d{1,2}):(\d{2})/.exec(after);
  if (t) {
    return {
      start: first.value,
      end: { date: first.value.date, time: `${t[1]!.padStart(2, '0')}:${t[2]}` },
    };
  }
  return { start: first.value, end: null };
}

export function extractSchedules(text: string): ExtractedSchedule[] {
  const out: ExtractedSchedule[] = [];
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const label = m[1]!.trim();
    const kind = classify(label);
    if (!kind) continue;
    const range = parseRange(m[2]!);
    if (!range) continue;
    if (kind === 'apply') {
      out.push({ kind: 'apply_start', start: range.start, end: null, label });
      if (range.end) out.push({ kind: 'apply_end', start: range.end, end: null, label });
    } else {
      out.push({ kind, start: range.start, end: range.end, label });
    }
  }
  return out;
}
