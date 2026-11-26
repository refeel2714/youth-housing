import { ASSET_BANDS, CAR_BANDS, compareBandToMax, findBand, formatWon, type Band } from '../bands.js';
import type { CheckName, CheckResult, EligibilityRule, Profile } from '../types.js';

function bandCheck(check: CheckName, label: string, bands: Band[], code: string | undefined, max: number | null): CheckResult {
  if (max === null) return { check, v: 'pass', message: null };
  const band = findBand(bands, code);
  if (!band) return { check, v: 'unknown', message: `${label}: 구간을 입력하면 확인할 수 있어요 (기준 ${formatWon(max)} 이하)` };
  const v = compareBandToMax(band, max);
  const verdict = v === 'pass' ? '충족' : v === 'fail' ? '초과' : '구간에 걸쳐 있어 확인 필요';
  return { check, v, message: `${label}: ${band.label} → 기준 ${formatWon(max)} 이하 ${verdict}` };
}

export const checkAsset = (rule: EligibilityRule, p: Profile) =>
  bandCheck('asset', '자산', ASSET_BANDS, p.assetBand, rule.assetMax);

export const checkCar = (rule: EligibilityRule, p: Profile) =>
  bandCheck('car', '자동차', CAR_BANDS, p.carBand, rule.carValueMax);
