-- 개발용 예시 공고. 운영 DB에 넣지 말 것.
-- 마이그레이션·seed.sql 을 넣은 로컬 DB에서: psql "$DATABASE_URL" -f supabase/dev-fixtures.sql
-- 날짜는 실행한 날(KST) 기준 상대값이라 언제 넣어도 접수 중·예정·마감이 섞여 보인다. 다시 넣으면 갈아 끼운다.
-- 제목은 모두 [예시]로 시작하고, 원문 링크는 각 기관의 공고 목록 첫 화면이다.
begin;

delete from notices where external_id like 'DEV-%';
delete from complexes where name like '[예시]%';

create temp table _d on commit drop as
  select (now() at time zone 'Asia/Seoul')::date as today;

-- 날짜(KST) + 시각 → timestamptz
create or replace function pg_temp.kst(d date, t time default '00:00') returns timestamptz
language sql immutable as $$ select (d + t) at time zone 'Asia/Seoul' $$;

with src as (select code, id from sources)
insert into notices (source_id, external_id, title, housing_type, url_original, url_apply, published_at,
                     status, region_codes, raw_text, parse_status, verified_at, verified_by)
select (select id from src where code = v.src), v.ext, v.title, v.htype::housing_type, v.url, v.apply,
       (select today from _d) + v.pub, v.status::notice_status, v.regions, '개발용 예시 공고', 'verified', now(), 'dev-fixtures'
from (values
  ('SEOUL_HOUSING', 'DEV-001', '[예시] 동대문구 청년안심주택(공공) 입주자 모집', 'youth_safe_public',
   'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008', 'https://soco.seoul.go.kr/youth/main/main.do',
   -7, 'open', array['11000','11230']),
  ('SEOUL_HOUSING', 'DEV-002', '[예시] 마포구 청년안심주택(민간) 추가 모집', 'youth_safe_private',
   'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008', null,
   0, 'upcoming', array['11000','11440']),
  ('LH_API', 'DEV-003', '[예시] 수원영통 행복주택 예비입주자 모집', 'happy_house',
   'https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do', 'https://apply.lh.or.kr/',
   -10, 'open', array['41000','41110','41117']),
  ('LH_API', 'DEV-004', '[예시] 인천 연수구 청년 매입임대주택 입주자 모집', 'youth_purchase_rental',
   'https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do', 'https://apply.lh.or.kr/',
   -1, 'upcoming', array['28000','28185']),
  ('SEOUL_HOUSING', 'DEV-005', '[예시] 강남구 청년안심주택(공공) 입주자 모집', 'youth_safe_public',
   'https://soco.seoul.go.kr/youth/bbs/BMSR00015/list.do?menuNo=400008', null,
   -40, 'closed', array['11000','11680']),
  ('LH_API', 'DEV-006', '[예시] 고양 일산 행복주택 입주자 모집', 'happy_house',
   'https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do', 'https://apply.lh.or.kr/',
   18, 'upcoming', array['41000','41280','41287'])
) as v(src, ext, title, htype, url, apply, pub, status, regions);

-- 일정: (공고, 종류, 차수, 시작일 오프셋, 시작 시각 or null(종일), 끝 오프셋 or null, 메모)
insert into schedules (notice_id, kind, seq, starts_at, ends_at, all_day, note)
select n.id, v.kind::schedule_kind, v.seq,
       pg_temp.kst(d.today + v.s, coalesce(v.t::time, '00:00')),
       case when v.e is null then null else pg_temp.kst(d.today + v.e, coalesce(v.t::time, '00:00')) end,
       v.t is null, v.note
from (values
  ('DEV-001', 'announce',    1, -7,  null,    null, '모집공고'),
  ('DEV-001', 'apply_start', 1, -2,  '10:00', null, '청약 접수 시작'),
  ('DEV-001', 'apply_end',   1,  3,  null,    null, '청약 접수 마감'),
  ('DEV-001', 'doc_result',  1, 20,  null,    null, '서류심사 대상자 발표'),
  ('DEV-001', 'winner',      1, 35,  null,    null, '최종 당첨자 발표'),
  ('DEV-001', 'contract',    1, 45,  null,    47,   '계약 체결'),
  ('DEV-002', 'announce',    1,  0,  null,    null, '모집공고'),
  ('DEV-002', 'apply_start', 1,  8,  '10:00', null, null),
  ('DEV-002', 'apply_end',   1, 10,  '17:00', null, null),
  ('DEV-002', 'winner',      1, 30,  null,    null, null),
  ('DEV-003', 'announce',    1, -10, null,    null, null),
  ('DEV-003', 'apply_start', 1, -5,  null,    null, null),
  ('DEV-003', 'apply_end',   1,  1,  null,    null, null),
  ('DEV-003', 'doc_submit',  1,  7,  null,    11,   '서류제출 대상자 서류 접수'),
  ('DEV-003', 'winner',      1, 40,  null,    null, null),
  ('DEV-003', 'move_in',     1, 90,  null,    null, '입주 지정기간 시작'),
  ('DEV-004', 'announce',    1, -1,  null,    null, null),
  ('DEV-004', 'apply_start', 1, 14,  null,    null, null),
  ('DEV-004', 'apply_end',   1, 16,  null,    null, null),
  ('DEV-004', 'winner',      1, 50,  null,    null, null),
  ('DEV-005', 'announce',    1, -40, null,    null, null),
  ('DEV-005', 'apply_start', 1, -30, '10:00', null, null),
  ('DEV-005', 'apply_end',   1, -25, null,    null, null),
  ('DEV-005', 'winner',      1,  5,  null,    null, null),
  ('DEV-006', 'announce',    1, 18,  null,    null, null),
  ('DEV-006', 'apply_start', 1, 25,  null,    null, null),
  ('DEV-006', 'apply_end',   1, 27,  null,    null, null)
) as v(ext, kind, seq, s, t, e, note)
join notices n on n.external_id = v.ext
cross join _d d;

-- 단지·공급 세대(일부 공고만)
insert into complexes (name, name_norm, operator, housing_type, region_code, address, nearest_station) values
  ('[예시] 청량리역 청년주택', '예시청량리역청년주택', 'SH', 'youth_safe_public', '11230', '서울특별시 동대문구 (예시 주소)', '청량리역'),
  ('[예시] 영통 행복주택',     '예시영통행복주택',     'LH', 'happy_house',       '41117', '경기도 수원시 영통구 (예시 주소)', '영통역');

insert into notice_units (notice_id, complex_id, target_group, unit_type, area_m2, deposit, monthly_rent, supply_count)
select n.id, c.id, v.tg::target_group, v.ut, v.area, v.dep, v.rent, v.cnt
from (values
  ('DEV-001', '[예시] 청량리역 청년주택', 'youth',    '16A', 16.5, 31000000, 140000, 42),
  ('DEV-001', '[예시] 청량리역 청년주택', 'youth',    '23B', 23.1, 45000000, 190000, 18),
  ('DEV-001', '[예시] 청량리역 청년주택', 'newlywed', '36A', 36.0, 72000000, 290000, 10),
  ('DEV-003', '[예시] 영통 행복주택',     'youth',    '26',  26.0, 24000000, 120000, 30),
  ('DEV-003', '[예시] 영통 행복주택',     'student',  '16',  16.0, 14000000,  70000, 12)
) as v(ext, cname, tg, ut, area, dep, rent, cnt)
join notices n on n.external_id = v.ext
join complexes c on c.name = v.cname;

-- 자격 규칙. 숫자는 화면·30초 진단 확인용 예시값(실제 공고 기준 아님). DEV-005·006 은 규칙 없음(정리 전)
insert into eligibility_rules (notice_id, target_group, age_min, age_max, age_ref_date, homeless_scope,
                               income_basis, income_year, income_pct_by_household, asset_max, car_value_max,
                               extra, source_clause, verified)
select n.id, 'youth', 19, 39, n.published_at, 'household', 'median', 2026,
       '{"1":150,"2":150,"3":150}'::jsonb, 251000000, 38030000, '{"unmarriedOnly":true}'::jsonb,
       '(예시) 만 19~39세 무주택 미혼 청년, 소득 기준중위소득 150% 이하', true
from notices n where n.external_id = 'DEV-001';

insert into eligibility_rules (notice_id, target_group, variant, age_min, age_max, age_ref_date, residence_codes,
                               homeless_scope, income_basis, income_year, income_pct_by_household, asset_max,
                               car_value_max, extra, source_clause, verified)
select n.id, v.tg::target_group, v.variant, v.amin, v.amax, n.published_at, v.res, v.hs::homeless_scope,
       v.ib::income_basis, v.iy, v.pct::jsonb, v.asset, v.car, v.extra::jsonb, v.clause, true
from (values
  -- 마포 민간: 서울 거주, 본인 무주택, 중위 120%
  ('DEV-002', 'youth', '', 19, 39, array['11000'], 'self', 'median', 2026, '{"1":120,"2":120}', 241000000, null::bigint,
   '{"unmarriedOnly":true}', '(예시) 서울 거주 만 19~39세 본인 무주택 미혼, 기준중위소득 120% 이하'),
  -- 영통 행복주택: 청년(도시근로자 기준, 기준표 미입력 → 소득은 확인 필요) + 대학생
  ('DEV-003', 'youth', '', 19, 39, null, 'household', 'urban_worker', 2025, '{"1":100,"2":100}', 254000000, 38030000,
   '{"unmarriedOnly":true}', '(예시) 만 19~39세 무주택 미혼, 도시근로자 월평균소득 100% 이하'),
  ('DEV-003', 'student', '', null, null, null, 'household', null, null, null, 101000000, 0,
   '{"studentOnly":true,"unmarriedOnly":true}', '(예시) 대학생·취업준비생 무주택 미혼, 자산 1억 100만 원 이하'),
  -- 인천 연수 매입임대: 인천 거주, 중위 100%, 1·2순위 구분
  ('DEV-004', 'youth', '1순위', 19, 39, array['28000'], 'self', 'median', 2026, '{"1":100,"2":100,"3":100}', 254000000, 38030000,
   '{"unmarriedOnly":true}', '(예시) 인천 거주 만 19~39세 무주택 미혼, 기준중위소득 100% 이하'),
  ('DEV-004', 'youth', '2순위', 19, 39, array['28000'], 'self', 'median', 2026, '{"1":150,"2":150,"3":150}', 254000000, 38030000,
   '{"unmarriedOnly":true}', '(예시) 인천 거주 만 19~39세 무주택 미혼, 기준중위소득 150% 이하')
) as v(ext, tg, variant, amin, amax, res, hs, ib, iy, pct, asset, car, extra, clause)
join notices n on n.external_id = v.ext;

commit;
