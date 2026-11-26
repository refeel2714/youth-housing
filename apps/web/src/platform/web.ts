import type { Platform } from './types';

const safe = {
  get(key: string) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* 저장 불가 환경 */ } },
};

export const platform: Platform = {
  name: 'web',
  async login() { window.location.href = '/api/auth/kakao'; }, // TODO: api 쪽 카카오 라우트
  openExternal(url) { window.open(url, '_blank', 'noopener,noreferrer'); },
  storage: safe,
};
