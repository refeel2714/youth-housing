// Claude 호출. 공고 하나 → Extraction(structured outputs 로 모양 보장).
// 키는 ANTHROPIC_API_KEY(SDK 가 환경변수에서 읽음), 모델은 PARSE_MODEL(기본 claude-opus-5-5).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { extraction, SYSTEM_PROMPT, userPrompt, type Extraction } from './extraction.js';

export const DEFAULT_MODEL = 'claude-opus-5-5';
/** 이보다 긴 본문은 잘라 보내지 않고 건너뛴다(검수 화면에서 직접 정리) */
export const MAX_BODY_CHARS = 120_000;

export interface ParseInput {
  title: string;
  publishedAt: string | null;
  rawText: string;
}

export interface ParseOutput {
  /** 실제로 답한 모델(거절 시 대체 모델이 답했을 수 있음) */
  model: string;
  extraction: Extraction;
  usage: { input: number; output: number };
}

/** 테스트에서 바꿔 끼울 수 있게 함수 모양으로 둔다 */
export type Extractor = (input: ParseInput) => Promise<ParseOutput>;

export class ParseError extends Error {}

export function claudeExtractor(o: { model?: string; client?: Anthropic } = {}): Extractor {
  const client = o.client ?? new Anthropic();
  const model = o.model || DEFAULT_MODEL;
  return async input => {
    if (input.rawText.length > MAX_BODY_CHARS) {
      throw new ParseError(`본문이 너무 김(${input.rawText.length}자)`);
    }
    const res = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      // 안전 분류기가 거절하면 서버가 대체 모델로 다시 돌린다
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(extraction) },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt(input) }],
    });
    if (res.stop_reason === 'refusal') throw new ParseError('모델이 응답을 거절함');
    if (res.stop_reason === 'max_tokens') throw new ParseError('응답이 max_tokens 에서 잘림');
    if (!res.parsed_output) throw new ParseError(`응답을 읽지 못함(stop_reason=${res.stop_reason})`);
    return {
      model: res.model,
      extraction: res.parsed_output,
      usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
    };
  };
}
