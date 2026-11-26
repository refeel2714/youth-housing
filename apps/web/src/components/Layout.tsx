import { NavLink, Outlet } from 'react-router-dom';

/** 하단 탭(캘린더·공고). 상세 화면은 탭 없이 띄운다 */
export function TabLayout() {
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
      </nav>
    </div>
  );
}
