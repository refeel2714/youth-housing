// Claude 가 공고 본문에서 뽑아 돌려줄 모양(structured outputs)과 프롬프트.
// 응답 모양을 바꾸거나 프롬프트를 고치면 PROMPT_VERSION 을 올린다(notice_parses 에 같이 남아 재현·비교에 쓴다).
import { HOMELESS_SCOPES, INCOME_BASES, SCHEDULE_KINDS, TARGET_GROUPS } from '@yh/schema/constants';
import * as z from 'zod/v4';

export const PROMPT_VERSION = '2026-11-26.1';

/** 정수 값. z.int() 는 안전 정수 범위를 설명문에 덧붙여 스키마가 지저분해져서 number 로 받고 convert.ts 에서 반올림한다 */
const nullableInt = () => z.number().nullable();

export const extractedSchedule = z.object({
  kind: z.enum(SCHEDULE_KINDS),
  date: z.string().describe('YYYY-MM-DD'),
  time: z.string().nullable().describe('HH:MM(24시간). 시각이 없으면 null'),
  endDate: z.string().nullable().describe('기간 일정(서류 제출 기간 등)의 끝 날짜 YYYY-MM-DD. 하루짜리면 null'),
  endTime: z.string().nullable().describe('끝 시각 HH:MM. 없으면 null'),
  label: z.string().describe('원문에 적힌 일정 이름 그대로(예: "청약 신청", "서류심사 대상자 발표")'),
});

export const extractedRule = z.object({
  targetGroup: z.enum(TARGET_GROUPS),
  variant: z.string().describe('같은 대상군 안의 공급 구분(예: "특별공급", "일반공급", "1순위"). 하나뿐이면 빈 문자열'),
  ageMin: nullableInt().describe('만 나이 하한. 조건 없으면 null'),
  ageMax: nullableInt().describe('만 나이 상한. 조건 없으면 null'),
  ageRefDate: z.string().nullable().describe('나이 계산 기준일 YYYY-MM-DD(보통 모집공고일). 본문에 없으면 null'),
  residence: z.array(z.string()).describe('거주 요건 지역 이름(예: "서울특별시", "경기도 성남시"). 거주 요건이 없으면 빈 배열'),
  homelessScope: z.enum(HOMELESS_SCOPES).nullable()
    .describe('household=세대원 전원 무주택, self=본인만 무주택, none=무주택 요건 없음을 명시. 언급이 없으면 null'),
  incomeBasis: z.enum(INCOME_BASES).nullable().describe('median=기준중위소득, urban_worker=도시근로자 가구원수별 월평균소득. 소득 조건 없으면 null'),
  incomeYear: nullableInt().describe('소득 기준표의 연도. 본문 표기 그대로("2025년도 도시근로자 월평균소득"이면 2025, "2026년 기준중위소득"이면 2026)'),
  incomePct: z.array(z.object({
    householdSize: z.number().describe('가구원 수 1~8'),
    pct: z.number().describe('기준 대비 퍼센트(예: 120)'),
  })).describe('가구원 수별 소득 상한 %. 모든 가구원 수에 같으면 1~8 모두 같은 값으로. "3인 이상 100%"면 3~8을 100으로'),
  assetMaxWon: nullableInt().describe('총자산 상한(원). "3억 4,500만원"이면 345000000. 없으면 null'),
  carValueMaxWon: nullableInt().describe('자동차 가액 상한(원). 없으면 null'),
  studentOnly: z.boolean().describe('대학생·취업준비생 등 학생만 신청 가능'),
  unmarriedOnly: z.boolean().describe('미혼만 신청 가능'),
  marriedOnly: z.boolean().describe('기혼(신혼부부·예비신혼부부)만 신청 가능'),
  householderOnly: z.boolean().describe('세대주만 신청 가능'),
  sourceClause: z.string().describe('이 조건의 근거가 된 원문 문장(줄여도 됨, 300자 이내)'),
});

export const extraction = z.object({
  schedules: z.array(extractedSchedule),
  rules: z.array(extractedRule),
  notes: z.string().nullable().describe('본문만으로 정리하지 못한 것(예: "자격 요건은 첨부 공고문에만 있음"). 없으면 null'),
});

export type Extraction = z.infer<typeof extraction>;
export type ExtractedRule = z.infer<typeof extractedRule>;
export type ExtractedSchedule = z.infer<typeof extractedSchedule>;

export const SYSTEM_PROMPT = `당신은 한국 청년 임대주택(청년안심주택, 행복주택, 청년 매입임대 등) 모집공고 본문에서 일정과 신청 자격을 옮겨 적는 정리 담당자입니다.
정리한 값은 사용자가 입력한 나이·소득·자산 구간과 비교하는 자동 판정에 그대로 쓰이므로, 본문에 적힌 것만 옮기고 추측하지 않습니다.

일정(schedules)
- 본문에 날짜가 적힌 일정만 넣습니다. 연도가 빠진 날짜는 공고 게시일과 같은 해로 봅니다(게시일보다 이르면 다음 해).
- kind: announce=모집공고, apply_start/apply_end=청약·신청 접수 시작과 마감, doc_submit=서류 제출, doc_result=서류심사·자격 발표,
  winner=당첨자·최종 발표, contract=계약, move_in=입주.
- 접수 기간 "11.20 10:00 ~ 11.24 17:00" 은 apply_start(11-20 10:00)와 apply_end(11-24 17:00) 두 개로 나눕니다.
  하루만 접수하면 apply_start 하나만 넣습니다. 서류 제출처럼 기간인 다른 일정은 하나로 넣고 endDate 를 씁니다.
- 1차·2차처럼 같은 종류가 여러 번이면 순서대로 모두 넣습니다. 예비입주자 일정도 label 로 구분해 넣습니다.

자격(rules)
- 대상군(targetGroup)별로 하나씩: youth=청년, student=대학생·취업준비생, newlywed=신혼부부·예비신혼부부·한부모, general=그 밖(고령자, 일반 등).
  같은 대상군 안에서 특별공급·일반공급, 순위처럼 기준이 다르면 variant 로 나눠 각각 넣습니다.
- 공급 유형마다 다른 소득·자산 기준이 표로 있으면 그 표를 그대로 옮깁니다. 기준이 본문에 없는 항목은 null(또는 빈 배열)로 둡니다.
  null 은 "조건 없음"으로 판정되므로, 본문이 "첨부 공고문 참조"처럼 내용을 생략한 경우에는 그 대상군의 규칙을 아예 만들지 말고 notes 에 적습니다.
- 나이는 만 나이 기준 숫자로. "만 19세 이상 39세 이하"는 ageMin 19, ageMax 39. 출생일 범위로 적혀 있으면 기준일의 만 나이로 바꿉니다.
- 금액은 원 단위 정수로 바꿉니다. 소득 기준이 금액으로만 적혀 있고 %가 없으면 incomeBasis 를 null 로 두고 notes 에 적습니다.
- 본문에 자격 내용이 전혀 없으면 rules 는 빈 배열입니다.`;

export function userPrompt(o: { title: string; publishedAt: string | null; rawText: string }): string {
  return [
    `공고 제목: ${o.title}`,
    `공고 게시일: ${o.publishedAt ?? '알 수 없음'}`,
    '',
    '<notice_body>',
    o.rawText,
    '</notice_body>',
    '',
    '위 본문에서 일정과 신청 자격을 정리해 주세요.',
  ].join('\n');
}
