import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { TabLayout } from './components/Layout';
import { Calendar } from './pages/Calendar';
import { Diagnose } from './pages/Diagnose';
import { DiagnoseResult } from './pages/DiagnoseResult';
import { NoticeDetail } from './pages/NoticeDetail';
import { NoticeList } from './pages/NoticeList';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<TabLayout />}>
          <Route path="/" element={<Calendar />} />
          <Route path="/notices" element={<NoticeList />} />
          <Route path="/diagnose" element={<Diagnose />} />
          <Route path="/diagnose/result" element={<DiagnoseResult />} />
        </Route>
        <Route path="/notices/:id" element={<NoticeDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
        {/* TODO: /complexes/:id, /watches, /settings */}
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
