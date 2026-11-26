import { describe, expect, it } from 'vitest';
import { feedLinks, sanitizeWatch, selectionOf, toggleRegionIn } from '../src/watch/store';

const A = '11111111-1111-1111-1111-111111111111';

describe('관심 목록 저장값 정리', () => {
  it('잘못된 항목·중복은 버리고 기본 알림은 하루 전', () => {
    const s = sanitizeWatch({
      notices: [{ id: A.toUpperCase(), title: 'a' }, { id: A, title: 'dup' }, { id: 'x', title: 'bad' }, null],
      regions: ['11000', 'seoul', '11000'],
      feed: { token: 'short', key: 'k', url: 'https://x' },
      dirty: true,
    });
    expect(s.notices.map(n => n.id)).toEqual([A]);
    expect(s.regions).toEqual(['11000']);
    expect(s.alarmDays).toEqual([1]);
    expect(s.feed).toBeNull();
    expect(s.dirty).toBe(false); // 구독이 없으면 올릴 것도 없음
    expect(sanitizeWatch(null)).toEqual({ notices: [], regions: [], alarmDays: [1], feed: null, dirty: false });
  });
  it('알림은 허용된 날만, 빈 배열(알림 끔)은 그대로', () => {
    expect(sanitizeWatch({ alarmDays: [0, 5, 7] }).alarmDays).toEqual([0, 7]);
    expect(sanitizeWatch({ alarmDays: [] }).alarmDays).toEqual([]);
  });
  it('구독 정보 보존', () => {
    const feed = { token: 'a'.repeat(24), key: 'b'.repeat(43), url: 'https://h.example/ics/aaa.ics' };
    const s = sanitizeWatch({ notices: [{ id: A, title: 't' }], feed, dirty: true });
    expect(s.feed).toEqual(feed);
    expect(s.dirty).toBe(true);
    expect(selectionOf(s)).toEqual({ noticeIds: [A], regionCodes: [], alarmDays: [1] });
  });
});

describe('관심 지역 고르기', () => {
  it('시도 전체를 고르면 그 시도의 구는 빠지고, 구를 고르면 시도 전체가 풀린다', () => {
    expect(toggleRegionIn(['11440', '11230', '41110'], '11000')).toEqual(['41110', '11000']);
    expect(toggleRegionIn(['11000', '41110'], '11440')).toEqual(['41110', '11440']);
    expect(toggleRegionIn(['11440'], '11440')).toEqual([]);
  });
});

it('캘린더 앱 주소', () => {
  const l = feedLinks('https://h.example/ics/tok.ics');
  expect(l.webcal).toBe('webcal://h.example/ics/tok.ics');
  expect(l.google).toBe('https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Fh.example%2Fics%2Ftok.ics');
});
