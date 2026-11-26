# youth-housing

청년 임대주택 공고 일정 + 자격 판정 서비스 (웹 먼저, 같은 코드로 토스 미니앱 빌드).

## 구조

| 경로 | 내용 |
| --- | --- |
| `apps/web` | Vite + React SPA. `VITE_TARGET=web\|toss` 로 `src/platform` 구현 교체 |
| `apps/api` | Hono 서버(조회·인증·알림·검수 화면, 웹 정적 파일 서빙) |
| `apps/collector` | 공고 수집·LLM 파싱 배치 |
| `packages/eligibility` | 자격 판정 순수 함수. 브라우저·서버 공용, 외부 의존성 없음 |
| `packages/schema` | DB enum과 같은 상수, zod 스키마, 타입 |
| `packages/db` | postgres.js 연결(api·collector 전용, web import 금지) |
| `supabase/` | 마이그레이션(적용된 파일은 수정 금지, 새 파일로만 변경)과 시드 |

## 개발

```sh
pnpm install
pnpm test            # 판정 경계값 테스트
pnpm typecheck
pnpm dev:api         # :8080
pnpm dev:web         # :5173, /api 는 :8080 으로 프록시
pnpm --filter @yh/web build:toss   # 토스 미니앱용 빌드(dist-toss)
```

DB: `supabase link` 후 `supabase db push`, 시드는 처음 한 번 `psql "$DIRECT_URL" -f supabase/seed.sql`.
환경변수는 `.env.example` 참고.

## 수집기

```sh
pnpm --filter @yh/collector collect:dry   # DB 없이 수집 결과만 출력(지역 코드는 seed.sql에서 읽음)
pnpm --filter @yh/collector start         # DATABASE_URL 에 적재, sources.last_* 갱신
```

- 소스: `LH_API`(LH 분양임대공고 API, 서울·경기·인천 임대 중 청년 관련 유형), `SEOUL_HOUSING`(서울주거포털 청년안심주택 모집공고).
- 공고는 `(source_id, external_id)`로 upsert. 새 공고·본문이 바뀐 미검수 공고는 `parse_status='pending'`으로 검수 대기열에 들어가고, 본문의 "■ 라벨 : 날짜" 줄에서 뽑은 일정이 `schedules`에 들어간다. 검수 완료 공고는 상태와 본문만 갱신하고 일정은 건드리지 않는다(`updated_at > verified_at`이면 다시 확인).
- 국내 공공 사이트는 해외 IP를 막을 수 있으므로 수집기는 국내에서 도는 곳(PC 등)에서 실행해도 된다.
- DB 통합 테스트: 마이그레이션·시드를 넣은 DB를 `TEST_DATABASE_URL`로 주면 `test/store.db.test.ts`가 돈다.
