// 비로그인 내 조건. 금액이 아니라 구간 코드만 기기 저장소(웹: localStorage, 토스: 토스 저장소)에 둔다.
// 로그인이 붙으면 이 값을 서버 user_profiles 로 옮기는 쪽만 추가한다(이 모듈은 로그인과 무관).
import { platform } from '@platform';
import { ASSET_BANDS, BAND_VERSION, CAR_BANDS, INCOME_BANDS, type Profile } from '@yh/eligibility';
import { HOMELESS_SCOPES } from '@yh/schema/constants';
import { useSyncExternalStore } from 'react';

const KEY = 'yh.profile.v1';

/** 수도권(서울·경기·인천) 밖에 산다는 표시. 실제 시도 코드와 겹치지 않아 거주 요건은 모두 '아님'이 된다 */
export const OUTSIDE_METRO = '99000';

interface Stored { bandVersion: number; savedAt: string; profile: Profile }

const int = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
const code = (v: unknown, codes: { code: string }[]) =>
  typeof v === 'string' && codes.some(b => b.code === v) ? v : undefined;

/** 저장소에서 읽은 값을 믿지 않고 항목별로 걸러 낸다. 빈 항목은 아예 키를 두지 않는다 */
export function sanitize(raw: unknown): Profile {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: Profile = {
    birthYear: int(p.birthYear, 1950, 2015),
    birthMonth: int(p.birthMonth, 1, 12),
    regionCode: typeof p.regionCode === 'string' && /^[0-9]{5}$/.test(p.regionCode) ? p.regionCode : undefined,
    homelessScope: (HOMELESS_SCOPES as readonly unknown[]).includes(p.homelessScope)
      ? (p.homelessScope as Profile['homelessScope']) : undefined,
    isHouseholder: bool(p.isHouseholder),
    householdSize: int(p.householdSize, 1, 8),
    incomeBand: code(p.incomeBand, INCOME_BANDS),
    assetBand: code(p.assetBand, ASSET_BANDS),
    carBand: code(p.carBand, CAR_BANDS),
    isStudent: bool(p.isStudent),
    isMarried: bool(p.isMarried),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Profile;
}

function read(): Profile | null {
  try {
    const v = JSON.parse(platform.storage.get(KEY) ?? 'null') as Stored | null;
    // 구간 정의가 바뀌었으면 금액 구간만 버리고 나머지는 살린다
    if (!v || typeof v !== 'object') return null;
    const p = sanitize(v.profile);
    if (v.bandVersion !== BAND_VERSION) { delete p.incomeBand; delete p.assetBand; delete p.carBand; }
    return p;
  } catch {
    return null;
  }
}

let current: Profile | null | undefined;
const listeners = new Set<() => void>();

export function getProfile(): Profile | null {
  if (current === undefined) current = read();
  return current;
}

export function saveProfile(p: Profile) {
  current = sanitize(p);
  const stored: Stored = { bandVersion: BAND_VERSION, savedAt: new Date().toISOString(), profile: current };
  platform.storage.set(KEY, JSON.stringify(stored));
  listeners.forEach(l => l());
}

export function clearProfile() {
  current = null;
  platform.storage.set(KEY, 'null');
  listeners.forEach(l => l());
}

export function useProfile(): Profile | null {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => listeners.delete(l); },
    getProfile,
  );
}

/** 판정에 영향이 큰 항목 중 비어 있는 것(결과 화면 안내용) */
export function missingFields(p: Profile): string[] {
  const m: [keyof Profile, string][] = [
    ['birthYear', '출생연도'], ['regionCode', '사는 곳'], ['homelessScope', '주택 보유'],
    ['householdSize', '가구원 수'], ['incomeBand', '소득'], ['assetBand', '자산'], ['isMarried', '혼인 여부'],
  ];
  return m.filter(([k]) => p[k] === undefined).map(([, label]) => label);
}
