// reportEngine.js
//
// measurements.js가 산출한 수치를 physiognomyKnowledge.js의 해석 규칙에 대입해
// 화면에 그릴 수 있는 리포트 데이터 구조를 만든다.

import {
  LITERATURE_SOURCES,
  SAMJEONG_INFO,
  OAK_INFO,
  OGWAN_INFO,
  FACE_SHAPE_INFO,
  SIBIGUNG_INFO,
  interpretSamjeong,
  interpretOak,
  interpretEyebrow,
  interpretEye,
  interpretNose,
  interpretMouth,
  interpretSibigung,
  classifyFaceShape,
  summarizeSynthesis,
  buildKeyMetrics,
  EAR_NOTE,
  EAR_CHECKLIST,
  DISCLAIMER_TEXT,
} from './physiognomyKnowledge.js';

function sourceTag(key) {
  const s = LITERATURE_SOURCES[key];
  return s ? { short: s.short, full: s.full, note: s.note } : null;
}

export function buildReport(measurements) {
  const sections = [];

  // 얼굴형/삼정은 종합 총평에서도 쓰이므로 먼저 계산해 둔다 (section push는 아래에서).
  const shapeKey = classifyFaceShape(measurements);
  const shapeData = FACE_SHAPE_INFO.shapes[shapeKey];
  const samjeong = interpretSamjeong(measurements.samjeongRatios);

  // 종합 총평 — 리포트 맨 위에 배치해 먼저 결론부터 보여준다. 아래 각 section이
  // 이미 문장으로 풀어낸 해석을 그대로 복사하지 않고, 같은 측정치의 tier 정보에서
  // 뽑은 짧은 어구만으로 새로 작성한 요약 문단이다 (physiognomyKnowledge.js의
  // summarizeSynthesis 참고). source가 없는 편집상 요약이라는 점도 이와 맞닿아 있다.
  sections.push({
    id: 'synthesis',
    title: '종합 총평',
    source: null,
    description: '아래 이마·코·턱 비율, 이목구비 등 세부 풀이를 모아 쉬운 말로 먼저 정리했어요.',
    text: summarizeSynthesis(measurements, {
      shapeLabel: shapeData.label,
      samjeongSpread: samjeong.spread,
      samjeongDominantKey: samjeong.dominantKey,
      samjeongDominantDirection: samjeong.dominantDirection,
    }),
  });

  // 얼굴형
  sections.push({
    id: 'face-shape',
    title: FACE_SHAPE_INFO.title,
    source: sourceTag(FACE_SHAPE_INFO.source),
    description: FACE_SHAPE_INFO.description,
    highlight: shapeData.label,
    text: [shapeData.desc],
  });

  // 삼정
  sections.push({
    id: 'samjeong',
    title: SAMJEONG_INFO.title,
    source: sourceTag(SAMJEONG_INFO.source),
    description: SAMJEONG_INFO.description,
    ratios: samjeong.ratios,
    regions: SAMJEONG_INFO.regions,
    text: [samjeong.text],
  });

  // 오악
  const oak = interpretOak(measurements);
  sections.push({
    id: 'oak',
    title: OAK_INFO.title,
    source: sourceTag(OAK_INFO.source),
    description: OAK_INFO.description,
    peaks: OAK_INFO.peaks,
    text: oak.text,
  });

  // 오관 - 눈썹
  const eyebrow = interpretEyebrow({
    lengthToEyeRatio: measurements.eyebrowLengthToEyeRatio,
    thicknessRatio: measurements.browThicknessRatio,
    archHeight: measurements.browArchHeight,
  });
  sections.push({
    id: 'ogwan-eyebrow',
    title: OGWAN_INFO.organs.eyebrow.label,
    source: sourceTag(OGWAN_INFO.source),
    description: `역할: ${OGWAN_INFO.organs.eyebrow.role}`,
    text: eyebrow.text,
  });

  // 오관 - 눈
  const eye = interpretEye({
    widthToFaceRatio: measurements.eyeWidthToFaceRatio,
    apertureRatio: measurements.eyeApertureRatio,
    spacingRatio: measurements.eyeSpacingRatio,
  });
  sections.push({
    id: 'ogwan-eye',
    title: OGWAN_INFO.organs.eye.label,
    source: sourceTag(OGWAN_INFO.source),
    description: `역할: ${OGWAN_INFO.organs.eye.role}`,
    text: eye.text,
  });

  // 오관 - 코
  const nose = interpretNose({
    widthToFaceRatio: measurements.noseWidthToFaceRatio,
    lengthToFaceRatio: measurements.noseLengthToFaceRatio,
    prominence: measurements.noseProminence,
  });
  sections.push({
    id: 'ogwan-nose',
    title: OGWAN_INFO.organs.nose.label,
    source: sourceTag(OGWAN_INFO.source),
    description: `역할: ${OGWAN_INFO.organs.nose.role}`,
    text: nose.text,
  });

  // 오관 - 입
  const mouth = interpretMouth({
    widthToNoseRatio: measurements.mouthWidthToNoseRatio,
    widthToFaceRatio: measurements.mouthWidthToFaceRatio,
  });
  sections.push({
    id: 'ogwan-mouth',
    title: OGWAN_INFO.organs.mouth.label,
    source: sourceTag(OGWAN_INFO.source),
    description: `역할: ${OGWAN_INFO.organs.mouth.role}`,
    text: mouth.text,
  });

  // 오관 - 귀 (자동 판정 없이 참고 사진 + 체크리스트만 제공)
  sections.push({
    id: 'ogwan-ear',
    title: OGWAN_INFO.organs.ear.label,
    source: sourceTag(OGWAN_INFO.source),
    description: `역할: ${OGWAN_INFO.organs.ear.role}`,
    text: [EAR_NOTE],
    checklist: EAR_CHECKLIST,
    qualitative: true,
    showEarPhotos: true,
  });

  // 십이궁 주요 7궁
  const sibigungNotes = interpretSibigung({
    eyeSpacingRatio: measurements.eyeSpacingRatio ?? 1,
    foreheadWidthRatio: measurements.foreheadWidthRatio ?? 0.9,
    noseWidthToFaceRatio: measurements.noseWidthToFaceRatio ?? 0.2,
    eyebrowLengthToEyeRatio: measurements.eyebrowLengthToEyeRatio ?? 1,
    cheekBalance: measurements.cheekBalance,
    chinWidthRatio: measurements.chinWidthRatio ?? 0.8,
    eyelidGapRatio: measurements.eyelidGapRatio ?? 0.4,
  });
  if (sibigungNotes.length) {
    sections.push({
      id: 'sibigung',
      title: SIBIGUNG_INFO.title,
      source: sourceTag(SIBIGUNG_INFO.source),
      description: SIBIGUNG_INFO.description,
      text: sibigungNotes.map((n) => `${SIBIGUNG_INFO.gungs[n.gung].label} (${SIBIGUNG_INFO.gungs[n.gung].region}) — ${n.text}`),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    coverage: measurements.coverage,
    keyMetrics: buildKeyMetrics(measurements),
    sections,
    disclaimer: DISCLAIMER_TEXT,
  };
}
