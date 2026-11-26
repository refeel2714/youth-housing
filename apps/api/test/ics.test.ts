import { describe, expect, it } from 'vitest';
import { toEvent } from '../src/feeds/routes.js';
import type { FeedScheduleRow } from '../src/feeds/store.js';
import { alarmTrigger, buildIcs, escapeText, foldLine, kstDate } from '../src/feeds/ics.js';

const now = new Date('2026-11-26T03:00:00Z');

describe('iCalendar', () => {
  it('TEXT 이스케이프', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('75바이트 접기: 한글이 잘리지 않고, 각 줄 75바이트 이하', () => {
    const line = `SUMMARY:${'청년안심주택'.repeat(10)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every(p => p.startsWith(' '))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
    expect(foldLine('SHORT')).toBe('SHORT');
  });

  it('종일 일정은 한국시간 날짜, 끝은 다음 날', () => {
    // 2026-12-08 00:00 KST = 12-07 15:00Z
    expect(kstDate(new Date('2026-12-07T15:00:00Z'))).toBe('20261208');
    const ics = buildIcs({
      name: '테스트', now,
      events: [
        { uid: 'a@x', startsAt: new Date('2026-12-07T15:00:00Z'), endsAt: null, allDay: true, summary: '[접수 시작] 공고', alarmDays: [1] },
        { uid: 'b@x', startsAt: new Date('2026-12-14T15:00:00Z'), endsAt: new Date('2026-12-16T15:00:00Z'), allDay: true, summary: '서류' },
        { uid: 'c@x', startsAt: new Date('2026-12-10T01:00:00Z'), endsAt: null, allDay: false, summary: '마감', alarmDays: [0, 1] },
      ],
    });
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261208\r\nDTEND;VALUE=DATE:20261209');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261215\r\nDTEND;VALUE=DATE:20261218');
    expect(ics).toContain('DTSTART:20261210T010000Z\r\nDTEND:20261210T013000Z');
    expect(ics).toContain('DTSTAMP:20261126T030000Z');
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(3);
    expect(ics).toContain('TRIGGER:-PT15H');
    expect(ics).toContain('TRIGGER:-P1D');
    expect(ics).toContain('TRIGGER:-PT1H');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
  });

  it('알림 시점: 종일은 며칠 전 오전 9시', () => {
    expect(alarmTrigger(1, true)).toBe('-PT15H');
    expect(alarmTrigger(3, true)).toBe('-PT63H');
    expect(alarmTrigger(0, true)).toBe('PT9H');
    expect(alarmTrigger(0, false)).toBe('-PT1H');
    expect(alarmTrigger(7, false)).toBe('-P7D');
  });

  it('일정 행 → 이벤트: 제목, 링크, 알림은 할 일 있는 날만', () => {
    const row: FeedScheduleRow = {
      schedule_id: '11111111-1111-1111-1111-111111111111', kind: 'apply_end', seq: 2,
      starts_at: new Date('2026-12-09T15:00:00Z'), ends_at: null, all_day: true, note: null,
      notice_id: '22222222-2222-2222-2222-222222222222', title: '마포 청년안심주택', url_original: 'https://o.example',
      url_apply: 'https://a.example', verified: false, watched: true, updated_at: now,
    };
    const e = toEvent(row, 'https://app.example', [1]);
    expect(e.summary).toBe('[접수 마감 2차] 마포 청년안심주택');
    expect(e.url).toBe('https://app.example/notices/22222222-2222-2222-2222-222222222222');
    expect(e.description).toContain('신청: https://a.example');
    expect(e.description).toContain('자동 수집');
    expect(e.alarmDays).toEqual([1]);
    expect(toEvent({ ...row, kind: 'winner' }, 'https://app.example', [1]).alarmDays).toEqual([]);
  });
});
