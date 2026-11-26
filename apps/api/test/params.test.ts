import { describe, expect, it } from 'vitest';
import { currentMonthKst, monthRange, parseCursor, parseLimit, parseRegions, parseStatuses, parseTypes } from '../src/lib/params.js';

describe('monthRange', () => {
  it('한국시간 1일 0시부터 다음 달 1일 0시까지', () => {
    expect(monthRange('2026-12')).toEqual({
      from: new Date('2026-11-30T15:00:00Z'),
      to: new Date('2026-12-31T15:00:00Z'),
    });
  });
  it('잘못된 형식은 null', () => {
    for (const m of ['2026-13', '2026-1', '202612', '']) expect(monthRange(m)).toBeNull();
  });
});

it('currentMonthKst: UTC 15시 이후는 한국 다음 날', () => {
  expect(currentMonthKst(new Date('2026-11-30T14:59:00Z'))).toBe('2026-11');
  expect(currentMonthKst(new Date('2026-11-30T15:00:00Z'))).toBe('2026-12');
});

describe('목록 파라미터', () => {
  it('비면 null(필터 끔), 잘못되면 undefined', () => {
    expect(parseRegions(undefined)).toBeNull();
    expect(parseRegions(' , ')).toBeNull();
    expect(parseRegions('11000,11230,11000')).toEqual(['11000', '11230']);
    expect(parseRegions('11000,seoul')).toBeUndefined();
    expect(parseTypes('happy_house')).toEqual(['happy_house']);
    expect(parseTypes('apartment')).toBeUndefined();
    expect(parseStatuses('open,upcoming')).toEqual(['open', 'upcoming']);
  });
  it('limit·cursor 범위', () => {
    expect(parseLimit(undefined)).toBe(20);
    expect(parseLimit('51')).toBeNull();
    expect(parseLimit('1.5')).toBeNull();
    expect(parseCursor(undefined)).toBe(0);
    expect(parseCursor('-1')).toBeNull();
  });
});
