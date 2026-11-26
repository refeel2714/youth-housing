import { describe, expect, it } from 'vitest';
import { addMonths, daysUntil, ddayLabel, eachDate, fmtDate, fmtTime, monthGrid, todayKst } from '../src/lib/dates';
import { fmtSchedule, fmtWon } from '../src/lib/format';

describe('dates', () => {
  it('todayKst 는 UTC 15시에 날짜가 넘어간다', () => {
    expect(todayKst(new Date('2026-11-26T14:59:59Z'))).toBe('2026-11-26');
    expect(todayKst(new Date('2026-11-26T15:00:00Z'))).toBe('2026-11-27');
  });
  it('addMonths 는 연도를 넘긴다', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });
  it('monthGrid: 2026년 11월은 일요일 시작, 5주', () => {
    const g = monthGrid('2026-11');
    expect(g).toHaveLength(5);
    expect(g[0]![0]).toEqual({ date: '2026-11-01', inMonth: true });
    expect(g[4]![6]).toEqual({ date: '2026-12-05', inMonth: false });
    expect(g.flat().filter(c => c.inMonth)).toHaveLength(30);
  });
  it('fmtDate·fmtTime·daysUntil', () => {
    expect(fmtDate('2026-11-27')).toBe('11.27(금)');
    expect(fmtTime('2026-11-21T01:00:00.000Z')).toBe('10:00');
    expect(daysUntil('2026-11-29', '2026-11-26')).toBe(3);
    expect(ddayLabel(0)).toBe('D-DAY');
    expect(eachDate('2026-11-29', '2026-12-02')).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  });
});

describe('format', () => {
  const base = { startsAt: '2026-12-02T15:00:00.000Z', startDate: '2026-12-03', endDate: '2026-12-03', endsAt: null, allDay: true };
  it('일정 표기', () => {
    expect(fmtSchedule(base)).toBe('12.3(목)');
    expect(fmtSchedule({ ...base, endsAt: '2026-12-06T15:00:00.000Z', endDate: '2026-12-07' })).toBe('12.3(목) ~ 12.7(월)');
    expect(fmtSchedule({ ...base, allDay: false, startsAt: '2026-12-03T01:00:00.000Z' })).toBe('12.3(목) 10:00');
  });
  it('금액 표기', () => {
    expect(fmtWon(31_000_000)).toBe('3,100만 원');
    expect(fmtWon(251_000_000)).toBe('2억 5,100만 원');
    expect(fmtWon(140_000)).toBe('14만 원');
  });
});
