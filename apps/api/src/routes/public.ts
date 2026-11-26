import { Hono } from 'hono';

export const publicRoutes = new Hono();

// TODO: 캘린더 월 조회(스택 문서 2-3의 쿼리), 공고·단지 상세
publicRoutes.get('/calendar', c => c.json({ items: [] }));
