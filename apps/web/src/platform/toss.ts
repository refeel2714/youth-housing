import type { Platform } from './types';

// TODO: @apps-in-toss/web-framework(SDK 3.x) 연동. appLogin(), 저장소, 알림 동의
export const platform: Platform = {
  name: 'toss',
  async login() { throw new Error('toss login not implemented'); },
  // TODO: SDK의 openURL 로 외부 브라우저 열기. 연동 전에는 WebView 안에서 이동한다
  openExternal(url) { window.location.href = url; },
  storage: {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* */ } },
  },
};
