import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Calendar } from './pages/Calendar';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/" element={<Calendar />} />
        {/* TODO: /diagnose, /notices/:id, /complexes/:id, /watches, /settings */}
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
