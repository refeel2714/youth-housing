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

## 화면·공개 API

| 경로 | 내용 |
| --- | --- |
| `GET /api/calendar?month=YYYY-MM&regions=&types=` | 그 달(KST)에 걸친 일정. 여러 날 일정은 걸친 달마다 나온다 |
| `GET /api/notices?status=open,upcoming&regions=&types=&q=&limit=&cursor=` | 접수 중(마감 임박순) → 예정(시작 빠른순) → 마감 |
| `GET /api/notices/:id` | 일정·공급 세대·자격 규칙·소득 기준표 |
| `GET /api/regions` | 지역 목록 |

- 화면에는 검수 완료(`verified`) 공고만 나온다. 공고는 아래 검수 화면에서 승인한다(`PUBLIC_SHOW_UNVERIFIED=1`은 로컬에서 수집 결과를 훑어볼 때만, 운영 금지).
- 공고 상태(접수 예정·중·마감)는 저장된 값 대신 접수 시작·마감 일정으로 요청 시각에 다시 계산한다.
- 예시 공고로 화면 보기: `psql "$DATABASE_URL" -f supabase/dev-fixtures.sql` (실행한 날 기준 상대 날짜, 제목이 `[예시]`, 다시 넣으면 갈아 끼움).
- 웹 번들은 zod 가 딸려 오지 않도록 `@yh/schema/constants`만 import 한다.
- API DB 테스트: `TEST_DATABASE_URL=... pnpm --filter @yh/api test`

## 검수 화면 (`/admin`)

API 서버가 그리는 HTML 화면(토스 빌드에 들어가지 않음). `ADMIN_PASSWORD`(8자 이상)와 `SESSION_SECRET`(16자 이상)을 넣어야 켜진다.
로컬: `pnpm dev:api` 후 http://localhost:8080/admin

- 로그인: 이름(검수자 표기) + 관리자 비밀번호. 세션은 서명 쿠키 12시간, 로그인 실패는 IP당 15분 10번.
- 목록 탭: 검수 대기(`pending`·`llm_parsed`, 접수 빠른 순) / 다시 확인(승인 뒤 원문 본문이 바뀜) / 공개 중 / 반려.
- 공고 화면: 왼쪽 수집 원문(날짜·금액·나이·비율 표시), 오른쪽 기본 정보·지역·일정·자격 조건 입력.
  - 일정은 한국시간, 시각을 비우면 종일. 같은 종류는 시작 순으로 1차·2차가 매겨지고 `(kind, seq)`로 upsert 해 id 를 유지한다.
  - 자격 조건: 금액은 만원, 소득 비율은 `100` 또는 `1:120, 2:110, 3-8:100`. 비운 칸은 "조건 없음"으로 판정된다.
  - 지역은 구까지 고르면 시도·상위 시 코드가 자동으로 붙는다.
- 버튼: 임시 저장(상태 유지) / 승인하고 공개(규칙도 확인됨으로) / 반려(메모 남김, 수집기가 다시 올리지 않음). 공개 중 공고는 "수정 저장" 또는 "공개 내리기".
- 승인할 때 검수자가 본 본문 해시를 `verified_content_hash`에 남긴다. 그 뒤 수집기가 본문 변경을 넣으면 "다시 확인" 탭에 뜬다.

## 소득 기준표

`supabase/seed.sql`의 `income_standards`: 2026년 기준중위소득(median, year=2026), 2025년도 도시근로자 가구원수별 월평균소득(urban_worker, year=2025, 2026년 공고에 적용). 금액은 100% 기준이고, 공고의 1·2인 가산(1인 120% 등)은 자격 조건의 비율로 넣는다.

## 수집기

```sh
pnpm --filter @yh/collector collect:dry   # DB 없이 수집 결과만 출력(지역 코드는 seed.sql에서 읽음)
pnpm --filter @yh/collector start         # DATABASE_URL 에 적재, sources.last_* 갱신
```

- 소스: `LH_API`(LH 분양임대공고 API, 서울·경기·인천 임대 중 청년 관련 유형), `SEOUL_HOUSING`(서울주거포털 청년안심주택 모집공고).
- 공고는 `(source_id, external_id)`로 upsert. 새 공고·본문이 바뀐 미검수 공고는 `parse_status='pending'`으로 검수 대기열에 들어가고, 본문의 "■ 라벨 : 날짜" 줄에서 뽑은 일정이 `schedules`에 들어간다. 검수 완료 공고는 상태와 본문만 갱신하고 일정은 건드리지 않는다(본문 해시가 승인 때와 다르면 검수 화면 "다시 확인"). 미검수 공고도 본문이 그대로면 상태만 바꿔 검수 화면 임시 저장을 덮지 않는다.
- 국내 공공 사이트는 해외 IP를 막을 수 있으므로 수집기는 국내에서 도는 곳(PC 등)에서 실행해도 된다.
- DB 통합 테스트: 마이그레이션·시드를 넣은 DB를 `TEST_DATABASE_URL`로 주면 `test/store.db.test.ts`가 돈다.
