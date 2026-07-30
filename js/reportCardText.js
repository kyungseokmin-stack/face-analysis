// reportCardText.js
//
// 리포트 카드(main.js 웹 화면 + infographic.js 다운로드 이미지)가 함께 쓰는 "섹션별 색상
// 테마"와 "헤드라인/요약 추출" 로직. 두 화면이 같은 카드 디자인 언어를 쓰도록 여기 한 곳에
// 모아 둔다(웹 화면만 카드형으로 바뀌고 다운로드 이미지는 그대로 남는 불일치를 피한다).

export const SECTION_THEMES = {
  synthesis: 'ink',
  'interest-highlight': 'ember',
  'face-shape': 'clay',
  samjeong: 'moss',
  oak: 'slate',
  'ogwan-eyebrow': 'ochre',
  'ogwan-eye': 'plum',
  'ogwan-nose': 'brick',
  'ogwan-mouth': 'pine',
  'ogwan-ear': 'taupe',
  sibigung: 'charcoal',
};

// css/style.css의 [data-theme] 배경색과 값을 맞춘다 — infographic.js는 캔버스라 CSS 커스텀
// 프로퍼티를 읽을 수 없어 값을 복제해 둔다. 색을 바꾸면 두 곳 다 함께 갱신해야 한다.
export const THEME_COLORS = {
  ink: '#2f3b52',
  ember: '#7c3a1c',
  clay: '#8a4a42',
  moss: '#55603f',
  slate: '#3f5060',
  ochre: '#7c5f2b',
  plum: '#5a3552',
  brick: '#8c4a2f',
  pine: '#2f6b5e',
  taupe: '#6b5642',
  charcoal: '#3a3530',
};

function splitFirstSentence(text) {
  if (!text) return { first: '', rest: '' };
  const idx = text.indexOf('. ');
  if (idx !== -1) return { first: text.slice(0, idx + 1), rest: text.slice(idx + 2).trim() };
  return { first: text, rest: '' };
}

// 항목이 하나뿐인 카드(얼굴형·삼정)는 그 문장 안에서 "무엇이 어떻다"에 해당하는 앞부분
// (첫 쉼표 또는 첫 마침표까지)을 헤드라인으로, 나머지를 요약으로 쓴다.
function splitLeadClause(line) {
  const body = line.includes('\n') ? line.slice(line.indexOf('\n') + 1) : line;
  const commaIdx = body.indexOf(',');
  if (commaIdx !== -1 && commaIdx < 40) {
    return { headline: body.slice(0, commaIdx).trim(), rest: body.slice(commaIdx + 1).trim() };
  }
  const periodIdx = body.indexOf('.');
  if (periodIdx !== -1) return { headline: body.slice(0, periodIdx).trim(), rest: body.slice(periodIdx + 1).trim() };
  return { headline: body.trim(), rest: '' };
}

/**
 * 섹션의 헤드라인/요약을 계산한다. 새 해석 문장을 짓지 않고 항상 기존 텍스트에서 뽑아 쓴다.
 * - 종합 총평(synthesis)은 다른 카드처럼 description에서 뽑은 메타 설명("~정리했어요")으로
 *   대신하지 않고, 애초에 헤드라인/요약 자체가 없다(null) — 호출부가 전체 문장을 그대로
 *   보여줘야 한다는 신호다.
 * - 항목이 하나뿐인 카드는 그 문장에서 뽑고, highlight(얼굴형의 오행 라벨 등)가 있으면
 *   그걸 헤드라인으로 우선한다.
 * - 항목이 여럿인 카드(오악·오관·십이궁 등)는 특정 항목 하나만 대표로 내세우면 나머지를
 *   배제하는 인상을 줄 수 있어, 이미 작성된 description의 첫 문장을 재사용한다.
 * @returns {{headline: string, summary: string} | null}
 */
export function deriveCardHeadline(section) {
  if (section.id === 'synthesis') return null;
  if (section.highlight) {
    const { rest } = splitLeadClause(section.text[0] || '');
    return { headline: section.highlight, summary: rest || section.description || '' };
  }
  if (section.text.length === 1) {
    const { headline, rest } = splitLeadClause(section.text[0]);
    return { headline, summary: rest };
  }
  const { first, rest } = splitFirstSentence(section.description || '');
  return { headline: first || section.title, summary: rest };
}
