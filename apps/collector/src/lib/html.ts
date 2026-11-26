// 게시판 본문 HTML → 줄 단위 텍스트. 인라인 태그(span, b 등)는 이어 붙이고 블록 태그만 줄을 나눈다.
const BLOCK = /<\/?(p|div|br|h[1-6]|li|ul|ol|tr|table|tbody|thead|section|article|blockquote|hr)\b[^>]*>/gi;
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&lsquo;': '‘', '&rsquo;': '’', '&ldquo;': '“', '&rdquo;': '”', '&middot;': '·',
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(BLOCK, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;/gi, e => ENTITIES[e.toLowerCase()] ?? e)
    .split('\n')
    .map(l => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
