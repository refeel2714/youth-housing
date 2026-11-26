-- 초기 시드. 처음 한 번: psql "$DIRECT_URL" -f supabase/seed.sql

insert into sources (code, name, method, base_url) values
  ('LH_API',        'LH 분양임대공고 API', 'api',   'https://apis.data.go.kr/B552555'),
  ('SEOUL_HOUSING', '서울주거포털',        'crawl', 'https://housing.seoul.go.kr'),
  ('SH',            'SH 서울주택도시공사', 'crawl', 'https://www.i-sh.co.kr')
on conflict (code) do nothing;

-- 시도 전체 행(뒤 세 자리 000)
insert into regions (code, sido, sigungu) values
  ('11000', '서울특별시', null),
  ('28000', '인천광역시', null),
  ('41000', '경기도',     null)
on conflict (code) do nothing;

-- 서울 25개 자치구(행정표준코드 시군구 5자리)
insert into regions (code, sido, sigungu) values
  ('11110','서울특별시','종로구'), ('11140','서울특별시','중구'),   ('11170','서울특별시','용산구'),
  ('11200','서울특별시','성동구'), ('11215','서울특별시','광진구'), ('11230','서울특별시','동대문구'),
  ('11260','서울특별시','중랑구'), ('11290','서울특별시','성북구'), ('11305','서울특별시','강북구'),
  ('11320','서울특별시','도봉구'), ('11350','서울특별시','노원구'), ('11380','서울특별시','은평구'),
  ('11410','서울특별시','서대문구'), ('11440','서울특별시','마포구'), ('11470','서울특별시','양천구'),
  ('11500','서울특별시','강서구'), ('11530','서울특별시','구로구'), ('11545','서울특별시','금천구'),
  ('11560','서울특별시','영등포구'), ('11590','서울특별시','동작구'), ('11620','서울특별시','관악구'),
  ('11650','서울특별시','서초구'), ('11680','서울특별시','강남구'), ('11710','서울특별시','송파구'),
  ('11740','서울특별시','강동구')
on conflict (code) do nothing;

-- TODO: 경기·인천 시군구 행. 행정표준코드관리시스템 원문에서 옮길 것(추측 입력 금지).

-- TODO: income_standards 2026년 기준중위소득·도시근로자 월평균소득 1~8인.
--       고시 원문 숫자를 옮기고 source_note에 출처를 적을 것. 예시 형식:
-- insert into income_standards (year, basis, variant, household_size, monthly_amount, source_note)
-- values (2026, 'median', 'default', 1, <원문 금액>, '보건복지부 고시 제2025-xxx호');
