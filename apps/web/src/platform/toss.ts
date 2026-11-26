import type { Platform } from './types';

// TODO: @apps-in-toss/web-framework(SDK 3.x) 연동. appLogin(), 저장소, 알림 동의
export const platform: Platform = {
  name: 'toss',
  async login() { throw new Error('toss login not implemented'); },
  storage: {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* */ } },
  },
};
