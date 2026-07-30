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

// "1.5배"처럼 숫자 안에 있는 마침표는 문장 종결이 아니므로, 뒤에 공백이 오거나 문자열
// 맨 끝에 오는 마침표만 문장 종결로 본다.
function findSentenceEndingPeriod(text) {
  const idx = text.indexOf('. ');
  if (idx !== -1) return idx;
  return text.endsWith('.') ? text.length - 1 : -1;
}

// 항목이 하나뿐인 카드(얼굴형·삼정)는 그 문장 안에서 "무엇이 어떻다"에 해당하는 앞부분을
// 헤드라인으로, 나머지를 요약으로 쓴다. 첫 문장 자체가 짧으면(문법적으로 완결된 채로도
// 헤드라인 길이에 적당하면) 쉼표에서 자르지 않고 문장 그대로 쓴다 — 그렇지 않으면 "~에
// 들어," 처럼 뒤에 이어지는 절이 있어야 말이 되는 어중간한 위치에서 잘려 어색해진다.
// 첫 문장이 너무 길 때만(삼정처럼 한 문장 안에 쉼표로 이어진 절이 여럿인 경우) 첫 쉼표까지
// 잘라 헤드라인을 더 짧게 만든다.
const LEAD_CLAUSE_MAX_LENGTH = 45;

function splitLeadClause(line) {
  const body = line.includes('\n') ? line.slice(line.indexOf('\n') + 1) : line;
  const periodIdx = findSentenceEndingPeriod(body);
  const firstSentence = periodIdx !== -1 ? body.slice(0, periodIdx) : body;
  const restAfterPeriod = periodIdx !== -1 ? body.slice(periodIdx + 1).trim() : '';

  if (firstSentence.length <= LEAD_CLAUSE_MAX_LENGTH) {
    return { headline: firstSentence.trim(), rest: restAfterPeriod };
  }
  const commaIdx = firstSentence.indexOf(',');
  if (commaIdx !== -1) {
    const restOfSentence = firstSentence.slice(commaIdx + 1).trim();
    return {
      headline: firstSentence.slice(0, commaIdx).trim(),
      rest: [restOfSentence, restAfterPeriod].filter(Boolean).join(' '),
    };
  }
  return { headline: firstSentence.trim(), rest: restAfterPeriod };
}

/**
 * 섹션의 헤드라인/요약을 계산한다. 새 해석 문장을 짓지 않고 항상 기존 텍스트에서 뽑아 쓴다.
 * - 종합 총평(synthesis)은 다른 카드처럼 description에서 뽑은 메타 설명("~정리했어요")으로
 *   대신하지 않고, 애초에 헤드라인/요약 자체가 없다(null) — 호출부가 전체 문장을 그대로
 *   보여줘야 한다는 신호다.
 * - 항목이 하나뿐인 카드는 그 문장에서 뽑고, highlight(얼굴형의 오행 라벨 등)가 있으면
 *   그걸 헤드라인으로 우선한다.
 * - 항목이 여럿인 카드(오악·오관·십이궁 등)는 description(카드 주제에 대한 일반 설명일
 *   뿐, 실제 해석 결과가 아니다)을 쓰지 않는다. 대신 각 항목의 실제 해석 문장에서 짧은
 *   리드 구절(splitLeadClause)을 뽑아, 첫 항목은 헤드라인으로 도드라지게 하고 나머지
 *   항목은 전부 요약에 이어 붙인다 — 특정 항목 하나만 대표로 내세우지 않으면서도, 실제
 *   측정 결과가 카드를 펼치기 전부터 드러난다. 이 코드베이스의 해설 문장은 대부분 "OOO
 *   (위치)가 ~한 편입니다"처럼 주어를 문장 맨 앞에 쓰므로, 리드 구절만 뽑아도 어떤 항목
 *   얘기인지 대개 그 자체로 드러난다.
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
  const leads = section.text.map((line) => splitLeadClause(line).headline).filter(Boolean);
  const [firstLead, ...restLeads] = leads;
  return { headline: firstLead || section.title, summary: restLeads.join(' · ') };
}
