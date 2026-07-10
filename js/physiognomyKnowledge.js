// physiognomyKnowledge.js
//
// 전통 관상학(觀相學)에서 통용되는 개념 체계를 정리한 지식 베이스.
// 「마의상법(麻衣相法)」「유장상법(柳莊相法)」「신상전편(神相全編)」 등 고전 문헌에서
// 후대로 전해져 통속적으로 널리 인용되는 틀(오관/오악/삼정/십이궁)을 기반으로 하되,
// 문헌마다 세부 유파·명칭 차이가 있어 "통설" 수준으로 정리했음을 명시한다.
//
// 수치 임계값은 문헌의 정성적 서술을 정량 판정으로 옮기기 위한 근사치이며, 실제 안면
// 비율 연구(예: 눈 사이 간격이 얼굴 너비의 약 46%라는 "golden ratio" 연구 등, 아래
// CALIBRATION_NOTE 참고)를 참고해 사람마다 결과가 고르게 갈리도록 보정했다. 전통 문헌이
// 직접 제시하는 정밀 수치가 아니라는 점은 변함없다.
//
// 이 파일은 순수 데이터/로직이며 DOM에 의존하지 않는다.

export const CALIBRATION_NOTE =
  '수치 구간은 마의상법 등 고전 문헌의 정성적 서술을 다섯 단계 정량 판정으로 옮기기 위해, ' +
  '눈 사이 간격·안면 비율에 관한 현대 안면 비율(anthropometry) 연구와 실사용자 테스트 결과를 ' +
  '참고해 보정한 근사치입니다. 특히 코 너비는 전용 랜드마크가 없어 좌표 범위로 추정하는데, ' +
  '실사용자 테스트에서 범위가 넓어 볼 부근까지 잡히는 문제가 발견되어 범위를 좁혔습니다.';

export const LITERATURE_SOURCES = {
  maui: {
    short: '마의상법',
    full: '麻衣相法 (마의상법)',
    note: '오대~송대 마의도자(麻衣道者)의 저술로 전해지는 관상학의 대표 고전. 오관론(五官論)·오악론(五嶽論)의 원형으로 가장 많이 인용된다.',
  },
  liuzhuang: {
    short: '유장상법',
    full: '柳莊相法 (유장상법)',
    note: '명대 원충철(袁忠徹) 계열로 전해지는 상법서. 십이궁(十二宮)·기색론(氣色論)을 체계화한 것으로 알려져 있다.',
  },
  shenxiang: {
    short: '신상전편',
    full: '神相全編 (신상전편)',
    note: '역대 상법을 집대성한 총서 성격의 문헌으로, 삼정(三停) 이론과 오행형(五行形) 얼굴 분류가 정리되어 있다.',
  },
};

/**
 * 값을 5단계(veryLow/low/mid/high/veryHigh)로 나눈다. 경계값은 오름차순 4개
 * [lowMax, midLowMax, midHighMax, highMax] 형태로 받는다 — 중간 구간이 항상 존재해
 * "평균적인 사람은 아무 설명도 못 받는" 공백이 생기지 않도록 한다.
 */
export function tier5(value, [lowMax, midLowMax, midHighMax, highMax]) {
  if (value == null || !Number.isFinite(value)) return 'mid';
  if (value < lowMax) return 'veryLow';
  if (value < midLowMax) return 'low';
  if (value <= midHighMax) return 'mid';
  if (value <= highMax) return 'high';
  return 'veryHigh';
}

// ---------------------------------------------------------------------------
// 삼정(三停) — 얼굴을 세 구간으로 나눠 인생의 초년/중년/말년운을 살피는 틀
// 상정: 발제(髮際, 이마 시작선) ~ 인당(印堂, 눈썹 사이)  → 15~30세, 초년운·부모운
// 중정: 인당 ~ 준두(準頭, 코끝)                          → 31~50세, 중년운·자수성가
// 하정: 인중(人中) ~ 턱끝                                → 51세 이후, 말년운·부하운/자녀운
// ---------------------------------------------------------------------------
export const SAMJEONG_INFO = {
  title: '삼정(三停)',
  source: 'shenxiang',
  description:
    '얼굴을 상정(上停)·중정(中停)·하정(下停) 셋으로 나누어 인생을 초년·중년·말년으로 대응해 살피는 전통적 틀입니다. ' +
    '세 구간의 길이가 서로 비슷하게 균형 잡힌 것을 예로부터 좋은 상으로 여겼습니다.',
  regions: {
    upper: { label: '상정 (이마)', life: '초년운 (15~30세), 부모·윗사람 복' },
    middle: { label: '중정 (눈썹~코끝)', life: '중년운 (31~50세), 자수성가·의지력' },
    lower: { label: '하정 (인중~턱)', life: '말년운 (51세 이후), 노후·대인관계' },
  },
};

// 삼정 스프레드가 이 값 미만이면 "고르게 균형 잡힌" 상으로 본다. interpretSamjeong과
// 종합 총평(summarizeSynthesis)이 같은 기준을 공유해야 판정이 어긋나지 않는다.
const SAMJEONG_BALANCE_THRESHOLD = 0.025;

// maxKey(가장 이상값에서 벗어난 구간)가 이상값보다 큰지(발달) 작은지(눌림)에 따라
// 완전히 다른 함의를 가지므로, 방향(developed/compressed)별로 별도 문장을 둔다.
// dev[key] > 0 → 그 구간이 다른 구간보다 넉넉하게 발달한 것 (developed)
// dev[key] < 0 → 그 구간이 다른 구간보다 좁게 눌린 것 (compressed)
const SAMJEONG_DOMINANT_TEXT = {
  upper: {
    developed: (intensity) => `상정(이마)이 ${intensity} 발달한 편으로, 전통적으로 초년에 두각을 나타내거나 윗사람의 도움을 받는 유형으로 풀이합니다.`,
    compressed: (intensity) => `상정(이마)이 다른 구간에 비해 ${intensity} 좁게 눌린 편으로, 전통적으로 초년보다는 중년·말년에 이르러 두각을 나타내는 대기만성형으로 풀이합니다.`,
  },
  middle: {
    developed: (intensity) => `중정(코를 중심으로 한 구간)이 ${intensity} 발달한 편으로, 전통적으로 자기 힘으로 기반을 다지는 자수성가형으로 풀이합니다.`,
    compressed: (intensity) => `중정(코를 중심으로 한 구간)이 다른 구간에 비해 ${intensity} 좁게 눌린 편으로, 전통적으로 스스로 기반을 다지기보다 주변의 도움에 기대는 흐름으로 풀이합니다.`,
  },
  lower: {
    developed: (intensity) => `하정(턱을 중심으로 한 구간)이 ${intensity} 발달한 편으로, 전통적으로 말년의 안정과 포용력을 보는 유형으로 풀이합니다.`,
    compressed: (intensity) => `하정(턱을 중심으로 한 구간)이 다른 구간에 비해 ${intensity} 좁게 눌린 편으로, 전통적으로 말년보다 초년·중년에 힘을 쏟는 유형으로 풀이합니다.`,
  },
};

export function interpretSamjeong(ratios) {
  // ratios: { upper, middle, lower } 각 구간이 전체에서 차지하는 비율(합 = 1)
  const { upper, middle, lower } = ratios;
  const ideal = 1 / 3;
  const dev = {
    upper: upper - ideal,
    middle: middle - ideal,
    lower: lower - ideal,
  };
  const maxKey = Object.keys(dev).reduce((a, b) => (Math.abs(dev[a]) > Math.abs(dev[b]) ? a : b));
  const direction = dev[maxKey] >= 0 ? 'developed' : 'compressed';
  const spread = Math.max(upper, middle, lower) - Math.min(upper, middle, lower);

  let balanceText;
  if (spread < SAMJEONG_BALANCE_THRESHOLD) {
    balanceText = '상정·중정·하정 세 구간의 비율이 매우 고르게 균형을 이루고 있습니다. 고전에서 말하는 "삼정이 균등하면 일생이 평탄하다"는 전형에 가깝습니다.';
  } else {
    const intensity = spread < 0.06 ? '약간' : '뚜렷하게';
    balanceText = SAMJEONG_DOMINANT_TEXT[maxKey][direction](intensity);
  }

  return {
    ratios,
    spread,
    dominantKey: maxKey,
    dominantDirection: direction,
    text: balanceText,
  };
}

// ---------------------------------------------------------------------------
// 오악(五嶽) — 이마·좌우 광대뼈·코·턱, 다섯 부위를 산에 비유해 골격의 기세를 보는 틀
// 남악(형산)=이마, 동악(태산)=좌관골, 서악(화산)=우관골, 중악(숭산)=코, 북악(항산)=턱
// ---------------------------------------------------------------------------
export const OAK_INFO = {
  title: '오악(五嶽)',
  source: 'maui',
  description:
    '이마·코·턱·좌우 광대뼈 다섯 부위를 다섯 산에 비유하여, 얼굴 골격이 서로 잘 호응하며 뚜렷하게 솟아 있는지를 보는 전통적 틀입니다. ' +
    '유파에 따라 산 이름과 방위 배속에 차이가 있어 여기서는 통설을 따랐습니다.',
  peaks: {
    forehead: { label: '남악(南嶽) · 이마', role: '조상·초년의 기운' },
    leftCheek: { label: '동악(東嶽) · 좌관골', role: '형제·자기 주도력' },
    rightCheek: { label: '서악(西嶽) · 우관골', role: '동료·재물 관리력' },
    nose: { label: '중악(中嶽) · 코', role: '자아·재물의 중심' },
    chin: { label: '북악(北嶽) · 턱', role: '말년·포용력, 부하운' },
  },
};

export const NOSE_PROMINENCE_BOUNDS = [0.42, 0.47, 0.53, 0.58];
export const FOREHEAD_WIDTH_BOUNDS = [0.75, 0.83, 0.92, 1.00];
export const CHIN_WIDTH_BOUNDS = [0.72, 0.80, 0.88, 0.94];

// 오관/심변관(審辨官) 프레이밍 — 자아·재물·의지력 중심의 해석.
const NOSE_PROMINENCE_TEXT = {
  veryLow: '심변관(코)의 융기가 매우 완만한 편입니다. 전통적으로 온화하고 남에게 베푸는 상으로 보는 한편, 자기 확신과 자존감이 약해 기회를 놓치기 쉽고 활동 범위가 좁아 재물이 잘 모이지 않는 상으로 보기도 합니다.',
  low: '심변관(코)의 융기가 다소 완만한 편으로, 전통적으로 온순하고 타협적인 상으로 풀이하나, 다소 소극적이라 스스로 확신을 키우는 노력이 필요한 상으로도 봅니다.',
  mid: '심변관(코)의 융기가 무난한 수준으로, 특별히 강하거나 약한 쪽으로 치우치지 않는 상입니다.',
  high: '심변관(코)이 다소 도드라진 편으로, 전통적으로 자존감이 있고 주관이 뚜렷한 상으로 풀이합니다.',
  veryHigh: '심변관(코)이 뚜렷하게 도드라진 편으로, 전통적으로 자존감이 강하고 재물을 스스로 일으키는 상으로 풀이하나, 지나치면 고집이 세고 남의 말을 듣지 않아 주변과 부딪히기 쉬운 상으로도 봅니다.',
};

// 오악(五嶽) 프레이밍 — 코가 오악의 중심(중악)으로서 다른 네 봉우리와 얼마나 조화를
// 이루는지, 골격 전체의 기세·균형을 보는 해석. NOSE_PROMINENCE_TEXT와 같은 측정치
// (noseProminence)를 쓰지만, 자아·재물이 아니라 골격 전체의 균형이라는 다른 틀로 읽는다.
const OAK_NOSE_PROMINENCE_TEXT = {
  veryLow: '중악(코)의 융기가 오악 가운데 가장 낮은 편으로, 전통적으로 다른 산들과 부드럽게 어우러지는 온화한 골격으로 보는 한편, 중심 봉우리가 낮아 오악 전체의 기세를 끌어올리지 못하고 다소 밋밋한 인상을 주는 상으로도 풀이합니다.',
  low: '중악(코)의 융기가 오악 중에서 다소 낮은 편으로, 전통적으로 주변 산들과 조화를 이루는 유순한 골격으로 풀이하나, 중심의 기세가 약해 균형을 다른 봉우리가 대신 떠받쳐야 하는 상으로도 봅니다.',
  mid: '중악(코)이 오악 가운데 무난한 높이를 이루어, 다섯 봉우리가 서로 튀지 않고 고르게 조화를 이루는 골격입니다.',
  high: '중악(코)이 오악의 중심으로서 뚜렷하게 솟아, 전통적으로 다른 네 산을 잘 아우르며 골격 전체의 기세를 이끄는 상으로 풀이합니다.',
  veryHigh: '중악(코)이 오악 가운데 유독 높이 솟아, 전통적으로 골격 전체의 기세를 힘 있게 이끄는 중심으로 보는 한편, 중심 봉우리만 지나치게 두드러지면 다른 산들과의 조화가 깨져 자기 주장이 앞서는 상으로도 봅니다.',
};

const FOREHEAD_WIDTH_TEXT = {
  veryLow: '남악(이마)이 매우 좁은 편입니다. 전통적으로 자기중심적인 성향으로 남과 부딪히기 쉽고, 부모덕이 약해 일찍부터 스스로 길을 개척해야 하는 상으로 보기도 합니다.',
  low: '남악(이마)이 다소 좁은 편으로, 전통적으로 부모덕에 기대기보다 스스로 길을 개척해야 하는 상으로 풀이합니다.',
  mid: '남악(이마)의 너비가 무난한 편으로, 초년운이 두드러지거나 눌리지 않는 균형 잡힌 상입니다.',
  high: '남악(이마)이 넓은 편으로, 전통적으로 총명함과 초년의 기회를 뜻하는 상으로 풀이합니다.',
  veryHigh: '남악(이마)이 매우 넓게 발달한 편으로, 전통적으로 총명함과 초년 성취운이 강한 상으로 풀이합니다.',
};

const CHIN_WIDTH_TEXT = {
  veryLow: '북악(턱)이 매우 갸름하고 뾰족한 편입니다. 전통적으로 감수성이 예민한 상으로 보는 한편, 턱은 재물을 담는 창고에 비유되어 이렇게 갸름하면 의지가 비교적 약하고 말년에 덕이 부족할 수 있어 인내력을 기르고 무리한 투자를 삼가야 하는 상으로 봅니다.',
  low: '북악(턱)이 갸름한 편으로, 전통적으로 섬세하고 사려 깊은 상으로 풀이하나, 말년운을 안정적으로 다지려면 꾸준한 끈기가 필요한 상으로도 봅니다.',
  mid: '북악(턱)의 너비가 무난한 편으로, 말년운이 특별히 강조되지 않는 균형 잡힌 상입니다.',
  high: '북악(턱)이 넓은 편으로, 전통적으로 말년의 포용력과 지구력을 뜻하는 상으로 풀이합니다.',
  veryHigh: '북악(턱)이 매우 넓고 안정적인 편으로, 전통적으로 말년의 포용력과 지구력이 강한 상으로 풀이합니다.',
};

export function interpretOak({ noseProminence, cheekBalance, chinWidthRatio, foreheadWidthRatio }) {
  const parts = [];

  parts.push(OAK_NOSE_PROMINENCE_TEXT[tier5(noseProminence, NOSE_PROMINENCE_BOUNDS)]);

  if (cheekBalance != null) {
    if (Math.abs(cheekBalance) < 0.02) {
      parts.push('동악·서악(좌우 광대)이 균형을 이루어, 전통적으로 좌우 대인관계가 안정적인 상으로 봅니다.');
    } else {
      const side = cheekBalance > 0 ? '왼쪽(동악)' : '오른쪽(서악)';
      parts.push(`${side} 광대가 상대적으로 도드라진 편입니다. 관상학에서는 좌우 균형의 미세한 차이 자체보다, 이런 차이가 자연스러운 개성으로 나타난다고 봅니다.`);
    }
  }

  parts.push(FOREHEAD_WIDTH_TEXT[tier5(foreheadWidthRatio, FOREHEAD_WIDTH_BOUNDS)]);
  parts.push(CHIN_WIDTH_TEXT[tier5(chinWidthRatio, CHIN_WIDTH_BOUNDS)]);

  return { text: parts };
}

// ---------------------------------------------------------------------------
// 오관(五官) — 눈썹·눈·코·입·귀, 얼굴의 다섯 감각기관을 보는 틀
// 눈=감찰관(監察官), 눈썹=보수관(保壽官), 코=심변관(審辨官), 입=출납관(出納官), 귀=채청관(採聽官)
// ---------------------------------------------------------------------------
export const OGWAN_INFO = {
  title: '오관(五官)',
  source: 'maui',
  description:
    '눈썹·눈·코·입·귀 다섯 기관 각각에 전통적 이름과 역할을 부여해 살피는 틀입니다. ' +
    '귀(채청관)는 촬영 각도와 머리카락에 크게 가려지고, 사용한 얼굴 랜드마크 모델이 귀 지점을 추적하지 않아 ' +
    '이번 분석에서는 정량 측정 없이 참고 설명만 제공합니다.',
  organs: {
    eyebrow: { label: '눈썹 · 보수관(保壽官)', role: '수명·형제운·감정 표현' },
    eye: { label: '눈 · 감찰관(監察官)', role: '심성·판단력·정신적 깊이' },
    nose: { label: '코 · 심변관(審辨官)', role: '자아·재물운·의지' },
    mouth: { label: '입 · 출납관(出納官)', role: '언행·의식주·대인관계' },
    ear: { label: '귀 · 채청관(採聽官)', role: '초년운·수명·지혜' },
  },
};

export const BROW_LENGTH_BOUNDS = [0.90, 1.00, 1.15, 1.30];
const BROW_THICKNESS_BOUNDS = [0.16, 0.21, 0.27, 0.32];
// 실사용자 캡처 2건에서 눈 가로세로 비율이 0.24 미만, 미간 비율이 1.45~1.55로 관측되어,
// 기존 가정치(각각 중심 0.31, 1.0)보다 실제 중심값이 낮고/높다는 것을 확인하고 재조정했다.
export const EYE_APERTURE_BOUNDS = [0.16, 0.20, 0.26, 0.32];
export const EYE_SPACING_BOUNDS = [1.15, 1.35, 1.60, 1.85];
export const NOSE_WIDTH_BOUNDS = [0.17, 0.19, 0.23, 0.26];
const NOSE_LENGTH_BOUNDS = [0.29, 0.32, 0.36, 0.39];
export const MOUTH_RATIO_BOUNDS = [1.35, 1.45, 1.60, 1.75];

const BROW_LENGTH_TEXT = {
  veryLow: '눈썹의 길이가 눈보다 뚜렷하게 짧습니다. 전통적으로 독립적이고 스스로 결정하는 성향으로 보는 한편, 형제·친구 등 인복이 부족해 어려울 때 주위의 도움을 받기 어렵고 고독한 상으로 풀이하기도 합니다. 성격이 날카롭고 직선적이어서 감정 기복이 클 수 있는 상으로도 봅니다.',
  low: '눈썹의 길이가 눈보다 다소 짧은 편입니다. 전통적으로 독립적인 성향이 있는 상으로 보나, 형제·친구복이 다소 약해 스스로 헤쳐나가야 하는 상으로도 풀이합니다.',
  mid: '눈썹과 눈의 길이 비율이 무난한 편으로, 대인관계에서 균형 잡힌 상으로 봅니다.',
  high: '눈썹의 길이가 눈보다 긴 편입니다. 전통적으로 "눈썹이 눈보다 길면 형제·친구복이 두텁다"고 풀이합니다.',
  veryHigh: '눈썹의 길이가 눈보다 상당히 긴 편입니다. 전통적으로 형제·친구복이 매우 두터운 상으로 풀이합니다.',
};

const BROW_THICKNESS_TEXT = {
  veryLow: '눈썹이 매우 가늘고 옅은 편입니다. 전통적으로 섬세하고 온화한 상으로 보는 한편, "눈썹이 매우 옅으면 형제가 없거나 외로운 상"으로 풀이하며 인덕이 약해 힘들 때 주변의 도움을 받기 어려운 상으로도 봅니다.',
  low: '눈썹이 가는 편입니다. 전통적으로 섬세한 감성을 지닌 상으로 풀이하나, 결단이 필요한 순간에 다소 우유부단해질 수 있는 상으로도 봅니다.',
  mid: '눈썹의 짙기가 무난한 편으로, 감정 표현이 과하지도 부족하지도 않은 상입니다.',
  high: '눈썹이 짙은 편입니다. 전통적으로 감정 표현이 분명하고 결단력이 있는 상으로 풀이합니다.',
  veryHigh: '눈썹이 매우 짙고 뚜렷한 편입니다. 전통적으로 결단력과 추진력이 강한 상으로 풀이하나, 지나치면 고집이 세고 다혈질적인 상으로도 봅니다.',
};

export function interpretEyebrow({ lengthToEyeRatio, thicknessRatio, archHeight }) {
  const parts = [];
  parts.push(BROW_LENGTH_TEXT[tier5(lengthToEyeRatio, BROW_LENGTH_BOUNDS)]);
  parts.push(BROW_THICKNESS_TEXT[tier5(thicknessRatio, BROW_THICKNESS_BOUNDS)]);

  if (archHeight != null) {
    if (archHeight > 0.28) {
      parts.push('눈썹의 곡선이 뚜렷하게 휘어 있는 편으로, 전통적으로 재치 있고 사교적인 상(유엽미柳葉眉 계열)으로 풀이합니다.');
    } else if (archHeight > 0.15) {
      parts.push('눈썹이 완만한 곡선을 이루는 편으로, 전통적으로 온화하면서도 사교적인 상으로 풀이합니다.');
    } else {
      parts.push('눈썹이 완만하고 일자에 가까운 편으로, 전통적으로 침착하고 우직한 상(일자미一字眉 계열)으로 풀이합니다.');
    }
  }
  return { text: parts };
}

const EYE_APERTURE_TEXT = {
  veryLow: '눈이 매우 작고 단단하게 자리 잡은 편입니다. 전통적으로 신중하고 속내를 잘 드러내지 않는 상으로 보는 한편, 지나치게 작으면 소심하고 마음이 좁아 큰 그림을 보지 못하는 상으로도 풀이합니다.',
  low: '눈이 작은 편에 속합니다. 전통적으로 신중한 상으로 풀이합니다.',
  mid: '눈의 크기가 무난한 편으로, 균형 잡힌 판단력을 보는 상입니다.',
  high: '눈이 큰 편에 속합니다. 전통적으로 감수성이 풍부하고 표현력이 좋은 상으로 풀이합니다.',
  veryHigh: '눈이 매우 큰 편에 속합니다. 전통적으로 감수성과 표현력이 매우 풍부한 상으로 보는 한편, 지나치게 크면 일을 성급하게 처리하고 감정 기복이 심할 수 있는 상으로도 봅니다.',
};

const EYE_SPACING_TEXT = {
  veryLow: '양 눈 사이(미간)가 매우 좁은 편입니다. 전통적으로 집중력이 강한 성격으로 보는 한편, 감정이 예민해 근심 걱정이 많고 눈앞의 이익에 치우쳐 소견이 좁아지기 쉬우며 부부간 다툼이 잦을 수 있는 상으로도 풀이합니다.',
  low: '양 눈 사이(미간)가 좁은 편입니다. 전통적으로 집중력이 강한 성격으로 풀이하나, 다소 조급하고 근심이 많아질 수 있는 상으로도 봅니다.',
  mid: '양 눈 사이 간격이 무난하여, 명궁(命宮)이 균형 잡힌 상으로 봅니다.',
  high: '양 눈 사이(미간)가 넓은 편입니다. 전통적으로 마음이 너그럽고 느긋한 성격으로 풀이하며, 십이궁 중 명궁(命宮)이 넓게 트인 상으로 봅니다.',
  veryHigh: '양 눈 사이(미간)가 매우 넓은 편입니다. 전통적으로 너그럽고 대범한 성격으로 보는 한편, 지나치게 넓으면 매사에 느긋하다 못해 집중력이 흐트러지고 야무지지 못한 상으로도 풀이합니다.',
};

export function interpretEye({ widthToFaceRatio, apertureRatio, spacingRatio }) {
  const parts = [];
  parts.push(EYE_APERTURE_TEXT[tier5(apertureRatio, EYE_APERTURE_BOUNDS)]);
  parts.push(EYE_SPACING_TEXT[tier5(spacingRatio, EYE_SPACING_BOUNDS)]);
  return { text: parts };
}

const NOSE_WIDTH_TEXT = {
  veryLow: '코가 매우 갸름한 편입니다. 전통적으로 명예나 성취를 재물보다 중시하는 상으로 풀이합니다.',
  low: '코가 갸름한 편입니다. 전통적으로 재물보다 명예나 성취를 중시하는 상으로 풀이합니다.',
  mid: '콧망울(코 너비)이 표준 범위에 들어, 재물운이 유난히 튀지 않는 편입니다.',
  high: '콧망울(코 너비)이 넓게 자리 잡은 편입니다. 전통적으로 재물을 모으고 지키는 힘이 좋은 상(재백궁財帛宮이 튼튼함)으로 풀이합니다.',
  veryHigh: '콧망울(코 너비)이 매우 넓은 편입니다. 전통적으로 재물을 모으고 지키는 힘이 매우 좋은 상으로 풀이합니다.',
};

const NOSE_LENGTH_TEXT = {
  veryLow: '코의 길이가 중정(中停)에서 짧은 비중을 차지하는 편으로, 전통적으로 순발력 있고 즉흥적인 기질을 보는 상입니다.',
  low: '코의 길이가 중정에서 다소 짧은 비중을 차지하는 편으로, 전통적으로 유연하고 임기응변에 강한 상입니다.',
  mid: '코의 길이가 중정(中停)에서 무난한 비중을 차지하는 편으로, 균형 잡힌 중년운을 보는 상입니다.',
  high: '코의 길이가 중정(中停)에서 넉넉한 비중을 차지하는 편으로, 전통적으로 신중하고 계획적인 중년운을 보는 상입니다.',
  veryHigh: '코의 길이가 중정(中停)에서 매우 넉넉한 비중을 차지하는 편으로, 전통적으로 매우 신중하고 치밀한 중년운을 보는 상입니다.',
};

export function interpretNose({ widthToFaceRatio, lengthToFaceRatio, prominence }) {
  const parts = [];
  parts.push(NOSE_WIDTH_TEXT[tier5(widthToFaceRatio, NOSE_WIDTH_BOUNDS)]);
  parts.push(NOSE_LENGTH_TEXT[tier5(lengthToFaceRatio, NOSE_LENGTH_BOUNDS)]);
  parts.push(NOSE_PROMINENCE_TEXT[tier5(prominence, NOSE_PROMINENCE_BOUNDS)]);
  return { text: parts };
}

const MOUTH_RATIO_TEXT = {
  veryLow: '입의 너비가 코 너비에 비해 매우 아담한 편입니다. 전통적으로 신중하고 절제된 언행을 하는 상으로 보는 한편, 지나치게 작으면 겁이 많고 소극적이며 불안감이 심하고 끈기가 부족한 상으로도 풀이합니다.',
  low: '입의 너비가 코 너비에 비해 아담한 편입니다. 전통적으로 신중하고 절제된 언행을 하는 상으로 풀이하나, 다소 소심하게 비칠 수 있는 상으로도 봅니다.',
  mid: '입과 코의 너비 비율이 통설적인 표준(코 너비의 약 1.5배)에 가까운 편입니다.',
  high: '입의 너비가 코 너비 대비 넉넉한 편입니다. 전통적으로 "입은 코보다 커야 복이 있다"는 통설처럼, 포용력 있고 사람을 잘 모으는 상(출납관出納官이 발달)으로 풀이합니다.',
  veryHigh: '입의 너비가 코 너비 대비 매우 넉넉한 편입니다. 전통적으로 담대하고 포용력이 커서 사람을 잘 모으는 상으로 보는 한편, 지나치게 크면 언행이 앞서 구설수에 오르기 쉽고 매사를 크게 벌이려다 결혼운 등에서 굴곡을 겪을 수 있는 상으로도 풀이합니다.',
};

const MOUTH_SAMJEONG_NOTE =
  '입은 하정(下停)에 속해 말년운·의식주 복을 함께 보는 자리로 여겨지므로, 위 오관 풀이는 하정 전체의 흐름과 함께 참고하는 것이 좋습니다.';

export function interpretMouth({ widthToNoseRatio, widthToFaceRatio }) {
  return {
    text: [MOUTH_RATIO_TEXT[tier5(widthToNoseRatio, MOUTH_RATIO_BOUNDS)], MOUTH_SAMJEONG_NOTE],
  };
}

export const EAR_NOTE =
  '귀(채청관採聽官)는 예로부터 초년운과 수명·지혜를 보는 자리로 여겨졌습니다. 다만 이번 분석에 쓰인 얼굴 랜드마크 인식 모델은 ' +
  '귀 지점을 좌표로 추출하지 않아, 자동으로 점수를 매기지는 않습니다. 대신 좌우로 고개를 돌렸을 때 촬영된 옆모습 사진을 아래에 ' +
  '그대로 보여드리니, 다음 전통적 기준에 직접 대조해보세요. 머리카락 길이·촬영 각도에 따라 귀가 충분히 보이지 않을 수도 있습니다.';

export const EAR_CHECKLIST = [
  { label: '귓불', desc: '두툼하고 늘어진 편이면 전통적으로 복(福)과 여유가 있는 상, 얇고 붙어 있으면 실속·현실감을 중시하는 상으로 봅니다.' },
  { label: '크기', desc: '얼굴에 비해 크면 전통적으로 담대하고 배포가 큰 상, 아담하면 섬세하고 신중한 상으로 풀이합니다.' },
  { label: '위치', desc: '눈썹보다 높이 붙어 있으면 전통적으로 총명하고 초년에 두각을 나타내는 상, 낮으면 대기만성형으로 봅니다.' },
  { label: '각도', desc: '귀가 머리에 바짝 붙어 있으면 전통적으로 신중한 상, 살짝 벌어져 있으면 활동적이고 개방적인 상으로 풀이합니다.' },
];

// ---------------------------------------------------------------------------
// 얼굴형(오행형, 五行形) — 목(木)·화(火)·토(土)·금(金)·수(水) 다섯 형으로 얼굴 윤곽을 분류
// ---------------------------------------------------------------------------
export const FACE_SHAPE_INFO = {
  title: '얼굴형 (오행형)',
  source: 'shenxiang',
  description:
    '얼굴의 가로세로 비율과 턱선의 각짐 정도를 다섯 가지 전통 유형(목형·화형·토형·금형·수형)에 대응해 분류합니다. ' +
    '실제 관상 문헌에서는 골격·기색·태도를 종합해 판단하므로, 여기서는 윤곽 비율에 근거한 간이 분류임을 밝힙니다.',
  shapes: {
    wood: { label: '목형(木形)', desc: '이마와 턱의 너비 차이가 적고 얼굴이 길쭉한 유형. 전통적으로 곧고 청렴한 인상으로 풀이합니다.' },
    fire: { label: '화형(火形)', desc: '이마가 좁고 턱이 뾰족한 역삼각형 유형. 전통적으로 예민하고 열정적인 인상으로 풀이합니다.' },
    earth: { label: '토형(土形)', desc: '이마·광대·턱의 너비가 비슷해 네모진 유형. 전통적으로 신뢰감 있고 안정적인 인상으로 풀이합니다.' },
    metal: { label: '금형(金形)', desc: '윤곽이 둥글면서도 각이 살아있는 유형. 전통적으로 결단력 있고 명예를 중시하는 인상으로 풀이합니다.' },
    water: { label: '수형(水形)', desc: '전체적으로 둥글고 부드러운 유형. 전통적으로 유연하고 사교적인 인상으로 풀이합니다.' },
  },
};

// 각 유형의 대표적인 특징 벡터(원형, prototype). 실제 측정치와의 거리(차이)가 가장 작은
// 유형을 고른다 — 이전처럼 순차적인 AND 조건으로 판정하면 특정 유형(금형)에 결과가 쏠리는
// 문제가 있어, 5개 유형에 공정하게 분포하도록 최근접 유형 매칭 방식으로 바꿨다.
const FACE_SHAPE_PROTOTYPES = {
  wood: { widthToHeightRatio: 0.66, jawToCheekRatio: 0.83, foreheadToCheekRatio: 0.88, jawAngleSharpness: 0.45 },
  fire: { widthToHeightRatio: 0.74, jawToCheekRatio: 0.68, foreheadToCheekRatio: 0.78, jawAngleSharpness: 0.72 },
  earth: { widthToHeightRatio: 0.86, jawToCheekRatio: 0.96, foreheadToCheekRatio: 0.96, jawAngleSharpness: 0.22 },
  metal: { widthToHeightRatio: 0.80, jawToCheekRatio: 0.88, foreheadToCheekRatio: 0.90, jawAngleSharpness: 0.48 },
  water: { widthToHeightRatio: 0.85, jawToCheekRatio: 0.84, foreheadToCheekRatio: 0.90, jawAngleSharpness: 0.18 },
};

// 특징별로 값의 범위가 달라(예: jawAngleSharpness는 0~1, 나머지는 0.6~1.0 근방) 거리를
// 그대로 더하면 범위가 넓은 특징이 판정을 좌우한다. 특징별 대략적인 변동폭으로 나눠
// 정규화한 뒤 유클리드 거리를 비교한다.
const FACE_SHAPE_FEATURE_SCALE = {
  widthToHeightRatio: 0.15,
  jawToCheekRatio: 0.15,
  foreheadToCheekRatio: 0.15,
  jawAngleSharpness: 0.3,
};

export function classifyFaceShape(measurements) {
  let bestShape = 'metal';
  let bestDistance = Infinity;
  for (const [shape, proto] of Object.entries(FACE_SHAPE_PROTOTYPES)) {
    let distanceSq = 0;
    for (const key of Object.keys(proto)) {
      const value = measurements[key];
      if (value == null || !Number.isFinite(value)) continue;
      const normalized = (value - proto[key]) / FACE_SHAPE_FEATURE_SCALE[key];
      distanceSq += normalized * normalized;
    }
    if (distanceSq < bestDistance) {
      bestDistance = distanceSq;
      bestShape = shape;
    }
  }
  return bestShape;
}

// ---------------------------------------------------------------------------
// 십이궁(十二宮) 중, 얼굴 랜드마크로 위치를 특정할 수 있는 주요 궁만 선별
// ---------------------------------------------------------------------------
export const SIBIGUNG_INFO = {
  title: '십이궁(十二宮) 중 주요 6궁',
  source: 'liuzhuang',
  description:
    '얼굴 각 부위에 인생의 열두 영역(궁宮)을 대응시키는 전통적 틀입니다. 이번 리포트에서는 랜드마크로 위치 특정이 비교적 명확한 ' +
    '여섯 궁만 소개합니다.',
  gungs: {
    myeong: { label: '명궁(命宮)', region: '양 눈썹 사이 (인당)', desc: '성격의 그릇과 정신적 여유를 보는 자리' },
    gwallok: { label: '관록궁(官祿宮)', region: '이마 정중앙', desc: '직업운·명예운을 보는 자리' },
    jaebaek: { label: '재백궁(財帛宮)', region: '코', desc: '재물운을 보는 자리' },
    hyeongje: { label: '형제궁(兄弟宮)', region: '눈썹', desc: '형제·동료복을 보는 자리' },
    bubu: { label: '부부궁(夫妻宮)', region: '눈꼬리(간문)', desc: '배우자운을 보는 자리' },
    nobok: { label: '노복궁(奴僕宮)', region: '턱 끝', desc: '아랫사람 복, 말년의 대인관계를 보는 자리' },
  },
};

export function interpretSibigung(measurements) {
  const notes = [];
  const eyeSpacingTier = tier5(measurements.eyeSpacingRatio, EYE_SPACING_BOUNDS);
  notes.push({
    gung: 'myeong',
    text:
      eyeSpacingTier === 'high' || eyeSpacingTier === 'veryHigh'
        ? '명궁(인당)이 넓게 트여 있어, 전통적으로 도량이 크고 여유로운 성정으로 풀이합니다.'
        : eyeSpacingTier === 'low' || eyeSpacingTier === 'veryLow'
        ? '명궁(인당)이 좁고 다부지게 자리 잡아, 전통적으로 집중력 있고 야무진 성정으로 풀이합니다.'
        : '명궁(인당)이 한쪽으로 치우치지 않아, 담담하고 안정된 성정으로 풀이합니다.',
  });

  const foreheadTier = tier5(measurements.foreheadWidthRatio, FOREHEAD_WIDTH_BOUNDS);
  notes.push({
    gung: 'gwallok',
    text:
      foreheadTier === 'high' || foreheadTier === 'veryHigh'
        ? '관록궁(이마 중앙)이 넓고 반듯하여, 전통적으로 직업적 성취운이 좋은 상으로 풀이합니다.'
        : foreheadTier === 'low' || foreheadTier === 'veryLow'
        ? '관록궁(이마 중앙)이 아담하여, 전통적으로 꾸준히 쌓아가는 대기만성형 직업운으로 풀이합니다.'
        : '관록궁(이마 중앙)이 평이한 편으로, 직업운에 이렇다 할 굴곡이 없는 상으로 풀이합니다.',
  });

  const noseTier = tier5(measurements.noseWidthToFaceRatio, NOSE_WIDTH_BOUNDS);
  notes.push({
    gung: 'jaebaek',
    text:
      noseTier === 'high' || noseTier === 'veryHigh'
        ? '재백궁(코)이 넉넉하여, 전통적으로 재물을 모으는 힘이 좋은 상으로 풀이합니다.'
        : noseTier === 'low' || noseTier === 'veryLow'
        ? '재백궁(코)이 아담하여, 전통적으로 재물보다 명예를 우선하는 상으로 풀이합니다.'
        : '재백궁(코)이 보통 수준이어서, 재물운에 특별한 쏠림 없이 흘러가는 상으로 풀이합니다.',
  });

  const browTier = tier5(measurements.eyebrowLengthToEyeRatio, BROW_LENGTH_BOUNDS);
  notes.push({
    gung: 'hyeongje',
    text:
      browTier === 'high' || browTier === 'veryHigh'
        ? '형제궁(눈썹)이 길게 발달하여, 전통적으로 형제·동료 복이 두터운 상으로 풀이합니다.'
        : browTier === 'low' || browTier === 'veryLow'
        ? '형제궁(눈썹)이 짧은 편으로, 전통적으로 소수의 인연에 집중하는 상으로 풀이합니다.'
        : '형제궁(눈썹)이 표준적인 길이로, 대인관계의 폭이 한쪽으로 기울지 않는 상으로 풀이합니다.',
  });

  if (measurements.cheekBalance != null) {
    const balanced = Math.abs(measurements.cheekBalance) < 0.02;
    notes.push({
      gung: 'bubu',
      text: balanced
        ? '부부궁(눈꼬리 옆 간문)이 좌우 균형을 이루어, 전통적으로 배우자와의 관계가 안정적인 상으로 풀이합니다.'
        : '부부궁(눈꼬리 옆 간문) 부근에 약간의 좌우 비대칭이 보여, 전통적으로 배우자운은 시기에 따라 기복이 있을 수 있는 상으로 풀이하나 큰 의미를 두지 않는 경우가 많습니다.',
    });
  }

  const chinTier = tier5(measurements.chinWidthRatio, CHIN_WIDTH_BOUNDS);
  notes.push({
    gung: 'nobok',
    text:
      chinTier === 'high' || chinTier === 'veryHigh'
        ? '노복궁(턱 끝)이 넓고 두툼하여, 전통적으로 아랫사람·주변 사람의 도움을 잘 받는 상으로 풀이합니다.'
        : chinTier === 'low' || chinTier === 'veryLow'
        ? '노복궁(턱 끝)이 갸름하여, 전통적으로 남에게 기대기보다 스스로 해결하는 상으로 풀이합니다.'
        : '노복궁(턱 끝)이 무난한 범위에 있어, 아랫사람 복이 크게 넘치거나 모자라지 않는 상으로 풀이합니다.',
  });

  return notes;
}

// ---------------------------------------------------------------------------
// 종합 총평(synthesis) — 위 각 section이 이미 완결된 문장으로 풀어낸 내용을 그대로
// 재사용하지 않고, tier/분류 결과에서 뽑은 짧은 어구(label 수준)만으로 새 요약 문장을
// 구성하기 위한 축약어 사전. 이 섹션은 source가 없는(어느 한 문헌의 직접 인용이 아닌)
// 편집상의 요약이므로, 문장 자체도 다른 section과 겹치지 않는 새 문장이어야 한다.
// ---------------------------------------------------------------------------
// 주의: 아래 값들은 summarizeSynthesis의 템플릿(`${part} 삼정`, `${part} 오악`)에
// 그대로 끼워 넣어지므로, "삼정"/"오악"을 주어로 반복하면 "~삼정, ~삼정"처럼 말이
// 겹친다(중복 명사 stutter). 그래서 각 값은 뒤에 붙는 명사를 포함하지 않는다.
const SAMJEONG_SUMMARY_KEYWORD = {
  balanced: '고르게 균형 잡힌',
  upper: { developed: '상정(이마)이 강조된', compressed: '상정(이마)이 눌린' },
  middle: { developed: '중정(코)이 강조된', compressed: '중정(코)이 눌린' },
  lower: { developed: '하정(턱)이 강조된', compressed: '하정(턱)이 눌린' },
};

const OAK_SUMMARY_KEYWORD = {
  veryLow: '중악이 낮아 온화하게 조화를 이루는',
  low: '중악이 차분한',
  mid: '고르게 조화를 이룬',
  high: '중악이 뚜렷하게 솟은',
  veryHigh: '중악이 강하게 두드러진',
};

const EYEBROW_SUMMARY_KEYWORD = {
  veryLow: '짧고 예리한 눈썹',
  low: '차분한 눈썹',
  mid: '균형 잡힌 눈썹',
  high: '길게 뻗은 눈썹',
  veryHigh: '길고 짙은 눈썹',
};

const MOUTH_SUMMARY_KEYWORD = {
  veryLow: '아담한 입매',
  low: '단정한 입매',
  mid: '표준적인 입매',
  high: '넉넉한 입매',
  veryHigh: '크고 대담한 입매',
};

const EYE_SPACING_SUMMARY_KEYWORD = {
  veryLow: '예민할 만큼 집중력이 강한 눈매',
  low: '집중력이 도드라진 눈매',
  mid: '균형 잡힌 눈매',
  high: '여유로운 눈매',
  veryHigh: '너그러운 눈매',
};

/**
 * 종합 총평 문단을 구성한다. 각 section이 이미 문장으로 풀어낸 해석을 그대로 복사하지
 * 않고, 같은 측정치의 tier/분류 결과에서 뽑은 짧은 어구만으로 새 문장 2개를 만든다.
 * @param {object} measurements - buildReport에 전달된 원본 측정치 (새 측정치를 추가하지 않음)
 * @param {{shapeLabel: string, samjeongSpread: number, samjeongDominantKey: string, samjeongDominantDirection: string}} ctx
 */
export function summarizeSynthesis(
  measurements,
  { shapeLabel, samjeongSpread, samjeongDominantKey, samjeongDominantDirection }
) {
  const samjeongPart =
    samjeongSpread < SAMJEONG_BALANCE_THRESHOLD
      ? SAMJEONG_SUMMARY_KEYWORD.balanced
      : SAMJEONG_SUMMARY_KEYWORD[samjeongDominantKey][samjeongDominantDirection];
  const oakPart = OAK_SUMMARY_KEYWORD[tier5(measurements.noseProminence, NOSE_PROMINENCE_BOUNDS)];
  const eyebrowPart = EYEBROW_SUMMARY_KEYWORD[tier5(measurements.eyebrowLengthToEyeRatio, BROW_LENGTH_BOUNDS)];
  const mouthPart = MOUTH_SUMMARY_KEYWORD[tier5(measurements.mouthWidthToNoseRatio, MOUTH_RATIO_BOUNDS)];
  const eyePart = EYE_SPACING_SUMMARY_KEYWORD[tier5(measurements.eyeSpacingRatio, EYE_SPACING_BOUNDS)];

  return [
    `${shapeLabel} 바탕에 ${samjeongPart} 삼정, ${oakPart} 오악이 어우러진 인상입니다.`,
    `오관 중에서는 ${eyebrowPart}과 ${eyePart}, ${mouthPart}가 함께 나타나 이 사람만의 개성으로 도드라지는 조합으로 풀이합니다.`,
  ];
}

// ---------------------------------------------------------------------------
// 핵심 지표 대시보드 — 리포트 맨 위에서 8개 핵심 비율을 5단계 게이지로 한눈에 보여준다.
// 텍스트 해석과 별개로, 실제 계산된 tier를 그대로 시각화하므로 장식이 아니라 실측 기반이다.
// ---------------------------------------------------------------------------
const TIER_INDEX = { veryLow: 0, low: 1, mid: 2, high: 3, veryHigh: 4 };

const KEY_METRIC_DEFS = [
  { id: 'forehead', label: '이마 너비', key: 'foreheadWidthRatio', bounds: FOREHEAD_WIDTH_BOUNDS, captions: ['매우 좁음', '좁음', '보통', '넓음', '매우 넓음'] },
  { id: 'browLength', label: '눈썹 길이', key: 'eyebrowLengthToEyeRatio', bounds: BROW_LENGTH_BOUNDS, captions: ['매우 짧음', '짧음', '보통', '긺', '매우 긺'] },
  { id: 'eyeSpacing', label: '미간 간격', key: 'eyeSpacingRatio', bounds: EYE_SPACING_BOUNDS, captions: ['매우 좁음', '좁음', '보통', '넓음', '매우 넓음'] },
  { id: 'eyeAperture', label: '눈 크기', key: 'eyeApertureRatio', bounds: EYE_APERTURE_BOUNDS, captions: ['매우 작음', '작음', '보통', '큼', '매우 큼'] },
  { id: 'noseWidth', label: '코 너비', key: 'noseWidthToFaceRatio', bounds: NOSE_WIDTH_BOUNDS, captions: ['매우 갸름', '갸름', '보통', '넓음', '매우 넓음'] },
  { id: 'noseProminence', label: '코 높이', key: 'noseProminence', bounds: NOSE_PROMINENCE_BOUNDS, captions: ['매우 낮음', '낮음', '보통', '높음', '매우 높음'] },
  { id: 'mouth', label: '입 너비', key: 'mouthWidthToNoseRatio', bounds: MOUTH_RATIO_BOUNDS, captions: ['매우 아담', '아담', '보통', '넉넉', '매우 넉넉'] },
  { id: 'chin', label: '턱 너비', key: 'chinWidthRatio', bounds: CHIN_WIDTH_BOUNDS, captions: ['매우 갸름', '갸름', '보통', '넓음', '매우 넓음'] },
];

export function buildKeyMetrics(measurements) {
  return KEY_METRIC_DEFS.map((def) => {
    const value = measurements[def.key];
    const tier = tier5(value, def.bounds);
    return {
      id: def.id,
      label: def.label,
      tierIndex: TIER_INDEX[tier],
      caption: def.captions[TIER_INDEX[tier]],
    };
  });
}

export const DISCLAIMER_TEXT = [
  '이 서비스는 마의상법·유장상법·신상전편 등에서 전해지는 전통 관상학의 개념(삼정·오악·오관·십이궁 등)을 소개하고, ' +
  '촬영된 얼굴의 기하학적 비율을 그 틀에 대입해 보여주는 문화·오락 콘텐츠입니다.',
  '관상학은 현대 과학적 방법으로 검증된 학문이 아닙니다. 이 결과를 성격·운명·건강에 대한 진단, 채용·개인 평가·의료적 판단의 근거로 사용하지 마십시오.',
  '얼굴 인식 모델과 기하학적 근사에 기반하므로 측정에는 오차가 있을 수 있으며, 문헌·유파에 따라 해석이 달라질 수 있습니다.',
  '고전 문헌은 같은 부위라도 정도에 따라 좋게도, 조심스럽게도 풀이해온 만큼 이 리포트도 길(吉)한 풀이와 흉(凶)한 풀이를 함께 담았습니다. 어느 쪽이든 실제 그 사람의 성격·능력·가치를 판단하는 근거가 아니라, 전통적으로 그렇게 전해져 온 이야기로만 받아들여 주십시오.',
];
