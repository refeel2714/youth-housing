// 소득·자산·차량 구간. 사용자 입력은 금액이 아니라 구간 코드로만 받는다.
// 정의를 바꾸면 user_profiles.band_version 을 올리고 BAND_VERSION 도 올린다.
export const BAND_VERSION = 1;

export interface Band {
  code: string;
  label: string;
  /** 원, 이상 */
  min: number;
  /** 원, 미만. null 이면 상한 없음 */
  max: number | null;
}

const MAN = 10_000;
const EOK = 100_000_000;

/** 연소득(세전) */
export const INCOME_BANDS: Band[] = [
  { code: 'i0', label: '2천만 원 미만', min: 0, max: 2000 * MAN },
  { code: 'i1', label: '2천~3천만 원', min: 2000 * MAN, max: 3000 * MAN },
  { code: 'i2', label: '3천~4천만 원', min: 3000 * MAN, max: 4000 * MAN },
  { code: 'i3', label: '4천~5천만 원', min: 4000 * MAN, max: 5000 * MAN },
  { code: 'i4', label: '5천~7천만 원', min: 5000 * MAN, max: 7000 * MAN },
  { code: 'i5', label: '7천만 원 이상', min: 7000 * MAN, max: null },
];

/** 총자산 */
export const ASSET_BANDS: Band[] = [
  { code: 'a0', label: '5천만 원 미만', min: 0, max: 5000 * MAN },
  { code: 'a1', label: '5천만~1억 원', min: 5000 * MAN, max: 1 * EOK },
  { code: 'a2', label: '1억~2억 원', min: 1 * EOK, max: 2 * EOK },
  { code: 'a3', label: '2억~3억 원', min: 2 * EOK, max: 3 * EOK },
  { code: 'a4', label: '3억~4억 원', min: 3 * EOK, max: 4 * EOK },
  { code: 'a5', label: '4억 원 이상', min: 4 * EOK, max: null },
];

/** 자동차 가액 */
export const CAR_BANDS: Band[] = [
  { code: 'c0', label: '차량 없음', min: 0, max: 1 },
  { code: 'c1', label: '2천만 원 미만', min: 1, max: 2000 * MAN },
  { code: 'c2', label: '2천~3,700만 원', min: 2000 * MAN, max: 3700 * MAN },
  { code: 'c3', label: '3,700만 원 이상', min: 3700 * MAN, max: null },
];

export function findBand(bands: Band[], code: string | undefined): Band | undefined {
  return code === undefined ? undefined : bands.find(b => b.code === code);
}

/**
 * 구간이 상한(이하) 기준을 만족하는지.
 * 구간 전체가 상한 이하 → pass, 구간 전체가 상한 초과 → fail, 걸치면 unknown.
 */
export function compareBandToMax(band: Band, limit: number): 'pass' | 'fail' | 'unknown' {
  // max 는 '미만'이므로 구간 안의 가장 큰 값은 max 바로 아래
  if (band.max !== null && band.max <= limit + 1) return 'pass';
  if (band.min > limit) return 'fail';
  return 'unknown';
}

export function formatWon(won: number): string {
  if (won >= EOK) {
    const eok = won / EOK;
    return `${Number.isInteger(eok) ? eok : eok.toFixed(2).replace(/0+$/, '')}억 원`;
  }
  return `${Math.round(won / MAN).toLocaleString('ko-KR')}만 원`;
}
