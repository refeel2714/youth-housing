import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useProfile } from '../profile/store';

/** 하단 탭(캘린더·공고·내 자격). 상세 화면은 탭 없이 띄운다 */
export function TabLayout() {
  const profile = useProfile();
  const onDiagnose = useLocation().pathname.startsWith('/diagnose');
  return (
    <div className="app">
      <Outlet />
      <nav className="tabbar" aria-label="주요 화면">
        <NavLink to="/" end>
          <svg viewBox="0 0 24 24" aria-hidden><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>캘린더
        </NavLink>
        <NavLink to="/notices">
          <svg viewBox="0 0 24 24" aria-hidden><rect x="5" y="3.5" width="14" height="17" rx="3" /><path d="M9 9h6M9 13h6M9 17h3" /></svg>공고
        </NavLink>
        {/* 진단을 했으면 결과로, 안 했으면 입력으로. 조건 수정 중에도 이 탭이 켜져 있게 한다 */}
        <NavLink to={profile ? '/diagnose/result' : '/diagnose'} className={() => (onDiagnose ? 'active' : '')}>
          <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /><path d="m15.5 11.5 1.5 1.5 3-3" /></svg>내 자격
        </NavLink>
      </nav>
    </div>
  );
}
