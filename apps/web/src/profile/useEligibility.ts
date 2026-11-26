// 30초 진단 결과: 진단 묶음(GET /api/eligibility)을 한 번 받아 기기에 저장된 내 조건으로 판정한다.
// 조건은 서버로 보내지 않는다.
import { judgeNotice, type NoticeJudgement, type Profile } from '@yh/eligibility';
import type { EligibilityBundleResponse, EligibilityNotice } from '@yh/schema/constants';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { todayKst } from '../lib/dates';
import { useProfile } from './store';

const TTL = 5 * 60_000;
let cache: { at: number; promise: Promise<EligibilityBundleResponse> } | null = null;

function loadBundle(force = false): Promise<EligibilityBundleResponse> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.promise;
  const promise = api.eligibility();
  cache = { at: Date.now(), promise };
  promise.catch(() => { if (cache?.promise === promise) cache = null; });
  return promise;
}

export interface Judged { notice: EligibilityNotice; judgement: NoticeJudgement }

export function judgeBundle(bundle: EligibilityBundleResponse, profile: Profile, today: string): Map<string, Judged> {
  const ctx = { incomeStandards: bundle.incomeStandards, today };
  return new Map(bundle.items.map(n => [n.id, { notice: n, judgement: judgeNotice(n.rules, profile, ctx) }]));
}

export type EligibilityState =
  | { status: 'no-profile'; profile: null; map: null }
  | { status: 'loading'; profile: Profile; map: null }
  | { status: 'error'; profile: Profile; map: null; error: Error; retry: () => void }
  | { status: 'ok'; profile: Profile; map: Map<string, Judged> };

/** enabled=false 면 내려받지 않는다(맞춤 필터를 끈 화면) */
export function useEligibility(enabled = true): EligibilityState {
  const profile = useProfile();
  const [bundle, setBundle] = useState<EligibilityBundleResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);
  const want = enabled && profile !== null;

  useEffect(() => {
    if (!want) return;
    let alive = true;
    setError(null);
    loadBundle(nonce > 0).then(b => { if (alive) setBundle(b); }, (e: Error) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [want, nonce]);

  const map = useMemo(
    () => (bundle && profile ? judgeBundle(bundle, profile, todayKst()) : null),
    [bundle, profile],
  );

  if (!profile) return { status: 'no-profile', profile: null, map: null };
  if (error) return { status: 'error', profile, map: null, error, retry: () => setNonce(n => n + 1) };
  if (!map) return { status: 'loading', profile, map: null };
  return { status: 'ok', profile, map };
}

/** 맞춤 필터에서 숨길 공고인지. 판정 대상이 아닌(오래된) 공고와 '확인 필요'는 남긴다 */
export const hiddenByMine = (map: Map<string, Judged> | null, noticeId: string) =>
  map?.get(noticeId)?.judgement.result === 'fail';
