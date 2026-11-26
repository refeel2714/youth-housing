-- 청년주택 일정 서비스 초기 스키마
create extension if not exists pgcrypto;   -- gen_random_uuid (PG13+는 기본 내장, 있어도 무해)
create extension if not exists citext;

-- ── enum ─────────────────────────────────────────────
create type housing_type   as enum ('youth_safe_public','youth_safe_private','happy_house','youth_purchase_rental','other');
create type schedule_kind  as enum ('announce','apply_start','apply_end','doc_submit','doc_result','winner','contract','move_in');
create type target_group   as enum ('youth','student','newlywed','general');
create type notice_status  as enum ('upcoming','open','closed','cancelled');
create type parse_status   as enum ('pending','llm_parsed','verified','rejected');
create type homeless_scope as enum ('self','household','none');
create type income_basis   as enum ('median','urban_worker');
create type collect_method as enum ('api','crawl');
create type auth_provider  as enum ('kakao','toss','email');
create type watch_target   as enum ('notice','complex','region');
create type notify_channel as enum ('email','toss');
create type notify_status  as enum ('pending','sent','failed','skipped');

create or replace function set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

-- ── 기준 데이터 ──────────────────────────────────────
create table regions (
  code     text primary key check (code ~ '^[0-9]{5}$'),  -- 시군구 코드, 시도 전체는 XX000
  sido     text not null,
  sigungu  text,                                          -- 시도 전체 행은 null
  unique (sido, sigungu)
);

create table sources (
  id              int generated always as identity primary key,
  code            text not null unique,                   -- LH_API, SEOUL_HOUSING, SH
  name            text not null,
  method          collect_method not null,
  base_url        text,
  enabled         boolean not null default true,
  last_run_at     timestamptz,
  last_success_at timestamptz,
  last_error      text
);

create table income_standards (
  year            smallint not null,
  basis           income_basis not null,
  variant         text not null default 'default',        -- 도시근로자 맞벌이 등
  household_size  smallint not null check (household_size between 1 and 8),
  monthly_amount  bigint not null check (monthly_amount > 0),  -- 원, 100% 기준 월액
  source_note     text,
  primary key (year, basis, variant, household_size)
);

-- ── 단지·공고 ───────────────────────────────────────
create table complexes (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  name_norm        text not null,                         -- 공백·괄호 제거한 비교용
  operator         text,                                  -- LH, SH, 민간 사업자명
  housing_type     housing_type not null,
  region_code      text not null references regions(code),
  address          text,
  lat              double precision,
  lng              double precision,
  nearest_station  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (region_code, name_norm)
);
create index complexes_region_idx on complexes (region_code);
create trigger complexes_updated before update on complexes for each row execute function set_updated_at();

create table notices (
  id            uuid primary key default gen_random_uuid(),
  source_id     int  not null references sources(id),
  external_id   text not null,                            -- LH PAN_ID, 포털 seq 등
  title         text not null,
  housing_type  housing_type not null,
  url_original  text not null,
  url_apply     text,
  published_at  date,
  status        notice_status not null default 'upcoming',
  region_codes  text[] not null default '{}',             -- 단지 시군구 + 시도 코드
  raw_text      text,                                     -- 본문(재파싱용)
  content_hash  text,                                     -- 본문 변경 감지
  parse_status  parse_status not null default 'pending',
  verified_at   timestamptz,
  verified_by   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (source_id, external_id)
);
create index notices_public_idx  on notices (published_at desc) where parse_status = 'verified';
create index notices_region_gin  on notices using gin (region_codes);
create index notices_review_queue on notices (created_at) where parse_status in ('pending','llm_parsed');
create trigger notices_updated before update on notices for each row execute function set_updated_at();

create table notice_parses (                              -- LLM 파싱 이력(검수·재현용)
  id              bigint generated always as identity primary key,
  notice_id       uuid not null references notices(id) on delete cascade,
  model           text not null,
  prompt_version  text not null,
  input_hash      text not null,
  output          jsonb not null,
  created_at      timestamptz not null default now()
);
create index notice_parses_notice_idx on notice_parses (notice_id, created_at desc);

create table notice_units (                               -- 공고별 공급 세대
  id            uuid primary key default gen_random_uuid(),
  notice_id     uuid not null references notices(id) on delete cascade,
  complex_id    uuid references complexes(id) on delete set null,
  target_group  target_group not null,
  unit_type     text,                                     -- 공고상 주택형(예: 16A)
  area_m2       numeric(6,2),
  deposit       bigint,                                   -- 원
  monthly_rent  bigint,                                   -- 원
  supply_count  int check (supply_count >= 0),
  note          text
);
create index notice_units_notice_idx  on notice_units (notice_id);
create index notice_units_complex_idx on notice_units (complex_id);

create table schedules (
  id         uuid primary key default gen_random_uuid(),
  notice_id  uuid not null references notices(id) on delete cascade,
  kind       schedule_kind not null,
  seq        smallint not null default 1,                 -- 같은 종류 차수(2차 서류 등)
  starts_at  timestamptz not null,                        -- 한국시간 기준으로 넣음
  ends_at    timestamptz,
  all_day    boolean not null default true,               -- 날짜만 있으면 00:00 KST
  note       text,
  unique (notice_id, kind, seq),
  check (ends_at is null or ends_at >= starts_at)
);
create index schedules_starts_idx on schedules (starts_at);
create index schedules_span_idx   on schedules ((coalesce(ends_at, starts_at)));

create table eligibility_rules (                          -- 공고 × 대상군(× 공급구분)
  id                       uuid primary key default gen_random_uuid(),
  notice_id                uuid not null references notices(id) on delete cascade,
  target_group             target_group not null,
  variant                  text not null default '',
  age_min                  smallint,
  age_max                  smallint,
  age_ref_date             date,                          -- 만 나이 기준일(보통 공고일)
  residence_codes          text[],                        -- 거주 요건, null이면 없음
  homeless_scope           homeless_scope,
  income_basis             income_basis,
  income_year              smallint,
  income_pct_by_household  jsonb,                         -- {"1":120,"2":110,...}
  asset_max                bigint,                        -- 원
  car_value_max            bigint,                        -- 원
  extra                    jsonb not null default '{}',   -- 학생·혼인 등, 키는 packages/schema에 정의
  source_clause            text,                          -- 근거 원문
  verified                 boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (notice_id, target_group, variant),
  check (age_min is null or age_max is null or age_min <= age_max),
  check (income_pct_by_household is null or jsonb_typeof(income_pct_by_household) = 'object'),
  check (income_basis is null or income_year is not null)
);
create trigger eligibility_rules_updated before update on eligibility_rules for each row execute function set_updated_at();

-- ── 계정 ────────────────────────────────────────────
create table users (
  id                    uuid primary key default gen_random_uuid(),
  auth_provider         auth_provider not null,
  provider_key          text not null,                    -- 카카오 회원번호, 토스 userKey, 이메일
  email                 citext,
  display_name          text,
  notify_email          boolean not null default false,
  notify_toss           boolean not null default false,
  notify_toss_agreed_at timestamptz,                      -- 토스 알림 동의 시각
  notify_offsets        smallint[] not null default '{7,1,0}',  -- 일정 며칠 전에 보낼지
  ics_token             text unique,                      -- .ics 구독 주소용 비밀값
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_login_at         timestamptz,
  unique (auth_provider, provider_key)
);
create trigger users_updated before update on users for each row execute function set_updated_at();

create table sessions (
  token_hash  bytea primary key,                          -- sha256(토큰), 원문은 저장 안 함
  user_id     uuid not null references users(id) on delete cascade,
  client      text not null check (client in ('web','toss')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index sessions_user_idx    on sessions (user_id);
create index sessions_expires_idx on sessions (expires_at);

create table user_profiles (                              -- 금액이 아니라 구간만 저장
  user_id         uuid primary key references users(id) on delete cascade,
  birth_year      smallint check (birth_year between 1950 and 2015),
  birth_month     smallint check (birth_month between 1 and 12),
  region_code     text references regions(code),
  homeless_scope  homeless_scope,
  is_householder  boolean,
  household_size  smallint check (household_size between 1 and 8),
  income_band     text,                                   -- 구간 코드, 정의는 packages/eligibility/bands.ts
  asset_band      text,
  car_band        text,
  is_student      boolean,
  is_married      boolean,
  band_version    smallint not null default 1,            -- 구간 정의가 바뀌면 올림
  updated_at      timestamptz not null default now()
);
create trigger user_profiles_updated before update on user_profiles for each row execute function set_updated_at();

create table watches (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references users(id) on delete cascade,
  target_type  watch_target not null,
  notice_id    uuid references notices(id) on delete cascade,
  complex_id   uuid references complexes(id) on delete cascade,
  region_code  text references regions(code),
  created_at   timestamptz not null default now(),
  check (num_nonnulls(notice_id, complex_id, region_code) = 1),
  check ((target_type = 'notice'  and notice_id   is not null)
      or (target_type = 'complex' and complex_id  is not null)
      or (target_type = 'region'  and region_code is not null))
);
create unique index watches_notice_uq  on watches (user_id, notice_id)   where notice_id   is not null;
create unique index watches_complex_uq on watches (user_id, complex_id)  where complex_id  is not null;
create unique index watches_region_uq  on watches (user_id, region_code) where region_code is not null;
create index watches_by_notice  on watches (notice_id)   where notice_id   is not null;
create index watches_by_complex on watches (complex_id)  where complex_id  is not null;
create index watches_by_region  on watches (region_code) where region_code is not null;

create table notifications (
  id                   bigint generated always as identity primary key,
  user_id              uuid not null references users(id) on delete cascade,
  schedule_id          uuid not null references schedules(id) on delete cascade,
  channel              notify_channel not null,
  offset_days          smallint not null,
  send_at              timestamptz not null,
  sent_at              timestamptz,
  status               notify_status not null default 'pending',
  attempts             smallint not null default 0,
  last_error           text,
  provider_message_id  text,
  created_at           timestamptz not null default now(),
  unique (user_id, schedule_id, channel, offset_days)    -- 중복 발송 방지
);
create index notifications_due_idx  on notifications (send_at) where status = 'pending';
create index notifications_user_idx on notifications (user_id, created_at desc);

-- ── RLS: 브라우저는 DB에 직접 붙지 않음. 정책 없이 전부 거부, API 서버(postgres 역할)만 접근 ──
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
