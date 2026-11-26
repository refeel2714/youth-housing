import { describe, expect, it } from 'vitest';
import { OUTSIDE_METRO, sanitize } from '../src/profile/store';

describe('기기 저장 조건 정리', () => {
  it('허용 밖 값과 빈 값은 버린다', () => {
    expect(sanitize({
      birthYear: 1998, birthMonth: 13, regionCode: 'seoul', homelessScope: 'maybe',
      householdSize: 9, incomeBand: 'i1', assetBand: 'zz', carBand: 'c0', isMarried: 'no', isStudent: false,
    })).toEqual({ birthYear: 1998, incomeBand: 'i1', carBand: 'c0', isStudent: false });
  });
  it('수도권 외 표시는 지역 코드로 통과', () => expect(sanitize({ regionCode: OUTSIDE_METRO })).toEqual({ regionCode: OUTSIDE_METRO }));
  it('깨진 값이면 빈 조건', () => expect(sanitize(null)).toEqual({}));
});
