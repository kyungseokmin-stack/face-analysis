// infographic.js
//
// 촬영된 정면 사진 위에 관상 콜아웃(설명선+라벨)을 그리고, 그 아래에 리포트 전문을
// 함께 그려 넣어 한 장의 이미지만으로 보관할 수 있는 인포그래픽 캔버스를 만든다.
// 이 사진은 촬영 중에만 브라우저 메모리에 있다가, 사용자가 "다운로드"를 누를 때만 사용자
// 자신의 기기에 저장된다 — 서버로 전송되지 않는다.

import { SECTION_THEMES, THEME_COLORS, deriveCardHeadline } from './reportCardText.js';

// css/style.css :root의 라이트 테마 값과 맞춘다(캔버스는 CSS 커스텀 프로퍼티를 읽을 수 없어
// 값을 그대로 복제해 둔다) — 값이 바뀌면 이 팔레트도 함께 갱신해야 한다.
const PALETTE = {
  bg: '#f7f4ef',
  text: '#211c16',
  muted: '#5c5245',
  accent: '#9c4a26',
  line: '#dba57f',
  divider: '#e8e0d3',
};

// 카드 배경(THEME_COLORS)이 전부 짙은 색이라, 그 위에 놓이는 텍스트는 웹 리포트 카드와
// 마찬가지로 밝은 색을 쓴다(css/style.css의 .report-card[data-theme] 오버라이드와 대응).
const CARD_TEXT = '#fbf6ef';
const CARD_TEXT_MUTED = 'rgba(251, 246, 239, 0.8)';

const CREDIT_TEXT = 'ⓒ 2026 kenmin';

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    img.src = dataUrl;
  });
}

function shortLabels(m) {
  return {
    forehead: m.foreheadWidthRatio > 0.98 ? '이마 넓음 · 초년운' : '이마 · 상정(上停)',
    eyebrow:
      m.eyebrowLengthToEyeRatio > 1.15 ? '눈썹 김 · 형제운' :
      m.eyebrowLengthToEyeRatio < 0.9 ? '눈썹 짧음 · 독립적' : '눈썹 · 보수관',
    eye:
      m.eyeSpacingRatio > 1.1 ? '미간 넓음 · 여유' :
      m.eyeSpacingRatio < 0.85 ? '미간 좁음 · 집중력' : '눈 · 감찰관',
    // "재백궁(財帛宮)"은 십이궁 해석(physiognomyKnowledge.js의 interpretSibigung)에서
    // noseWidthToFaceRatio(코 "너비")로 판정한다. 여기 라벨은 noseProminence(코 "높이/
    // 돌출도")를 기준으로 하는 서로 다른 측정치이므로, 같은 궁 이름을 붙이면 리포트
    // 본문의 재백궁 해석과 모순될 수 있다(예: 콧대는 높지만 폭은 좁은 코). 돌출도는
    // 오악(五嶽)의 중악(中嶽) 프레임에 해당하므로 그쪽 이름으로 바꾼다.
    nose:
      m.noseProminence > 0.55 ? '콧대 높음 · 중악 발달' :
      m.noseProminence < 0.35 ? '코 완만 · 온화' : '코 · 심변관',
    mouth: m.mouthWidthToNoseRatio > 1.6 ? '입 넉넉 · 출납관' : '입 · 출납관',
    chin:
      m.chinWidthRatio > 0.9 ? '턱 넓음 · 북악' :
      m.chinWidthRatio < 0.7 ? '턱 갸름 · 섬세' : '턱 · 하정(下停)',
  };
}

/** 지정한 최대 너비 안에 들어가도록 폰트 크기를 줄여가며 맞춘다(콜아웃 라벨용, 한 줄). */
function fitFontSize(ctx, text, maxWidth, startSize, minSize = 10) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `600 ${size}px sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 1;
  }
  return size;
}

/** 글자 단위로 줄바꿈한다(한국어는 띄어쓰기 기준 wrap이 아니어도 자연스럽다). */
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let current = '';
  for (const ch of text) {
    const test = current + ch;
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 리포트 섹션들을 웹 화면과 같은 "주제별 색상 카드" 블록으로 미리 레이아웃한다(실제
 * 캔버스 크기를 정하기 전 필요한 높이를 알아야 하므로, 임시 컨텍스트로 먼저 측정한다).
 * 다운로드 이미지는 인터랙션이 없어 "더 보기"로 펼칠 수 없으므로, 웹 화면의 접힌 상태
 * (헤드라인+요약)를 그대로 보여준다 — 단, 종합 총평(deriveCardHeadline이 null 반환)은
 * 웹에서도 항상 펼쳐서 보여주는 카드이므로 여기서도 전체 문장을 그대로 다 보여준다.
 */
function layoutSections(measureCtx, sections, maxWidth, sizes) {
  const innerWidth = maxWidth - sizes.cardPadding * 2;
  const blocks = [];
  let y = 0;
  for (const section of sections) {
    const headlineData = deriveCardHeadline(section);

    measureCtx.font = `600 ${sizes.eyebrowSize}px sans-serif`;
    const eyebrowText = section.source ? `${section.title} · ${section.source.short}` : section.title;
    const eyebrowLines = wrapText(measureCtx, eyebrowText, innerWidth);

    let headlineLines = [];
    let summaryLines = [];
    let bodyLines = [];
    if (headlineData) {
      measureCtx.font = `bold ${sizes.headlineSize}px sans-serif`;
      headlineLines = wrapText(measureCtx, headlineData.headline, innerWidth);
      if (headlineData.summary) {
        measureCtx.font = `${sizes.summarySize}px sans-serif`;
        summaryLines = wrapText(measureCtx, headlineData.summary, innerWidth).slice(0, 3);
      }
    } else {
      // 종합 총평 — '\n'(십이궁류 헤더 구분자)은 이 카드에는 나오지 않지만 만약을 대비해 제거.
      measureCtx.font = `${sizes.summarySize}px sans-serif`;
      bodyLines = wrapText(measureCtx, section.text.join(' ').replace(/\n/g, ' '), innerWidth);
    }

    const blockHeight =
      sizes.cardPadding * 2 +
      eyebrowLines.length * sizes.eyebrowLineHeight +
      sizes.headlineGap +
      headlineLines.length * sizes.headlineLineHeight +
      (summaryLines.length ? sizes.summaryGap + summaryLines.length * sizes.summaryLineHeight : 0) +
      (bodyLines.length ? sizes.summaryGap + bodyLines.length * sizes.summaryLineHeight : 0);

    blocks.push({ section, eyebrowLines, headlineLines, summaryLines, bodyLines, y, height: blockHeight });
    y += blockHeight + sizes.sectionGap;
  }
  return { blocks, totalHeight: blocks.length ? y - sizes.sectionGap : 0 };
}

function drawSections(ctx, blocks, x, startY, maxWidth, sizes) {
  for (const block of blocks) {
    const theme = SECTION_THEMES[block.section.id];
    const cardY = startY + block.y;

    ctx.fillStyle = theme ? THEME_COLORS[theme] : PALETTE.divider;
    roundRectPath(ctx, x, cardY, maxWidth, block.height, sizes.cardRadius);
    ctx.fill();

    const textColor = theme ? CARD_TEXT : PALETTE.text;
    const mutedColor = theme ? CARD_TEXT_MUTED : PALETTE.muted;
    const textX = x + sizes.cardPadding;
    let ty = cardY + sizes.cardPadding + sizes.eyebrowSize;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = mutedColor;
    ctx.font = `600 ${sizes.eyebrowSize}px sans-serif`;
    for (const line of block.eyebrowLines) {
      ctx.fillText(line, textX, ty);
      ty += sizes.eyebrowLineHeight;
    }

    ty += sizes.headlineGap;
    ctx.fillStyle = textColor;
    ctx.font = `bold ${sizes.headlineSize}px sans-serif`;
    for (const line of block.headlineLines) {
      ctx.fillText(line, textX, ty);
      ty += sizes.headlineLineHeight;
    }

    if (block.summaryLines.length) {
      ty += sizes.summaryGap;
      ctx.fillStyle = mutedColor;
      ctx.font = `${sizes.summarySize}px sans-serif`;
      for (const line of block.summaryLines) {
        ctx.fillText(line, textX, ty);
        ty += sizes.summaryLineHeight;
      }
    }

    if (block.bodyLines.length) {
      // bodyLines는 종합 총평(헤드라인 없는 카드) 전용이다 — 웹 화면과 마찬가지로 카드가
      // 길어지더라도 굵게 강조해달라는 요청에 따라 bold를 쓴다.
      ty += sizes.summaryGap;
      ctx.fillStyle = textColor;
      ctx.font = `bold ${sizes.summarySize}px sans-serif`;
      for (const line of block.bodyLines) {
        ctx.fillText(line, textX, ty);
        ty += sizes.summaryLineHeight;
      }
    }
  }
}

/**
 * @param {{photoDataUrl:string, landmarks:any[], groups:object, anchors:object, measurementLines:object, measurements:object, report:object}} params
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function buildInfographic({ photoDataUrl, landmarks, groups, anchors, measurementLines, measurements, report }) {
  const img = await loadImage(photoDataUrl);
  const photoW = img.naturalWidth;
  const photoH = img.naturalHeight;

  const faceShapeLabel = report.sections.find((s) => s.id === 'face-shape')?.highlight ?? '';

  const margin = Math.round(photoW * 0.46);
  const topBar = Math.round(photoH * 0.1);
  const canvasWidth = photoW + margin * 2;
  const contentPadding = Math.round(canvasWidth * 0.06);
  const textMaxWidth = canvasWidth - contentPadding * 2;

  const sizes = {
    cardPadding: Math.round(photoW * 0.045),
    cardRadius: Math.round(photoW * 0.035),
    eyebrowSize: Math.round(photoW * 0.032),
    eyebrowLineHeight: Math.round(photoW * 0.048),
    headlineGap: Math.round(photoW * 0.02),
    headlineSize: Math.round(photoW * 0.052),
    headlineLineHeight: Math.round(photoW * 0.075),
    summaryGap: Math.round(photoW * 0.02),
    summarySize: Math.round(photoW * 0.042),
    summaryLineHeight: Math.round(photoW * 0.06),
    sectionGap: Math.round(photoW * 0.045),
  };

  // 1차: 임시 컨텍스트로 본문 레이아웃을 미리 계산해 필요한 전체 높이를 구한다.
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  const { blocks, totalHeight: sectionsHeight } = layoutSections(
    measureCtx,
    report.sections,
    textMaxWidth,
    sizes
  );

  const sectionsTop = topBar + photoH + Math.round(photoW * 0.08);
  const bottomBarHeight = Math.round(photoW * 0.14);
  const canvasHeight = sectionsTop + sectionsHeight + bottomBarHeight;

  // 2차: 실제 캔버스를 필요한 크기로 만들어 전부 그린다.
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = PALETTE.text;
  ctx.font = `bold ${Math.round(topBar * 0.4)}px sans-serif`;
  ctx.fillText('관상 분석 리포트', canvas.width / 2, topBar * 0.4);
  ctx.fillStyle = PALETTE.accent;
  ctx.font = `${Math.round(topBar * 0.26)}px sans-serif`;
  ctx.fillText(faceShapeLabel, canvas.width / 2, topBar * 0.78);

  const photoX = margin;
  const photoY = topBar;

  // 사진은 촬영 중 미리보기와 같은 방향(좌우 반전)으로 그린다.
  ctx.save();
  ctx.translate(photoX + photoW, photoY);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0, photoW, photoH);
  ctx.restore();

  ctx.strokeStyle = PALETTE.line;
  ctx.lineWidth = 2;
  ctx.strokeRect(photoX, photoY, photoW, photoH);

  const toPixel = (a) => {
    if (!a) return null;
    // 정규화 좌표(원본 카메라 프레임 기준, 비반전) → 반전해서 그린 사진 위의 픽셀 좌표로 변환
    return { x: photoX + (1 - a.x) * photoW, y: photoY + a.y * photoH };
  };

  if (landmarks && groups) drawFaceContours(ctx, landmarks, groups, toPixel);
  if (measurementLines) drawMeasurementLines(ctx, measurementLines, toPixel, measurements, { photoX, photoW, photoY, photoH });

  const labels = shortLabels(measurements);
  const callouts = [
    { anchor: anchors.forehead, label: labels.forehead, side: 'right' },
    { anchor: anchors.eyebrow, label: labels.eyebrow, side: 'left' },
    { anchor: anchors.eye, label: labels.eye, side: 'right' },
    { anchor: anchors.nose, label: labels.nose, side: 'left' },
    { anchor: anchors.mouth, label: labels.mouth, side: 'right' },
    { anchor: anchors.chin, label: labels.chin, side: 'left' },
  ].filter((c) => c.anchor);

  const marginTextWidth = margin * 0.82;
  drawCalloutGroup(ctx, callouts.filter((c) => c.side === 'left'), toPixel, {
    innerX: photoX - margin * 0.08,
    align: 'right',
    maxWidth: marginTextWidth,
    topY: photoY + photoH * 0.14,
    bottomY: photoY + photoH * 0.88,
  });
  drawCalloutGroup(ctx, callouts.filter((c) => c.side === 'right'), toPixel, {
    innerX: photoX + photoW + margin * 0.08,
    align: 'left',
    maxWidth: marginTextWidth,
    topY: photoY + photoH * 0.14,
    bottomY: photoY + photoH * 0.88,
  });

  // 구분선
  ctx.strokeStyle = PALETTE.divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(contentPadding, sectionsTop - Math.round(photoW * 0.04));
  ctx.lineTo(canvas.width - contentPadding, sectionsTop - Math.round(photoW * 0.04));
  ctx.stroke();

  // 리포트 전문(제목+설명)을 사진 아래에 그대로 그려 넣는다.
  drawSections(ctx, blocks, contentPadding, sectionsTop, textMaxWidth, sizes);

  ctx.fillStyle = PALETTE.muted;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(bottomBarHeight * 0.22)}px sans-serif`;
  ctx.fillText(
    '전통 관상학 기반 문화 콘텐츠 · 과학적 진단이 아닙니다',
    canvas.width / 2,
    sectionsTop + sectionsHeight + bottomBarHeight * 0.36
  );
  ctx.font = `${Math.round(bottomBarHeight * 0.2)}px sans-serif`;
  ctx.fillText(
    CREDIT_TEXT,
    canvas.width / 2,
    sectionsTop + sectionsHeight + bottomBarHeight * 0.72
  );

  return canvas;
}

/** 원본(비반전) 정규화 좌표 기준 minX/maxX 구간을, 반전된 사진 위 픽셀 x 범위로 바꾼다. */
function pixelSpanX(toPixel, minX, maxX, y) {
  const a = toPixel({ x: minX, y });
  const b = toPixel({ x: maxX, y });
  return { x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x) };
}

/** 실제로 인식한 랜드마크 연결선(눈썹/눈/입술/얼굴 윤곽)을 사진 위에 그대로 그린다 — "이 얼굴을 실제로 뜯어봤다"는 걸 시각적으로 보여준다. */
function drawContour(ctx, landmarks, connections, toPixel, { color, width }) {
  if (!connections) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (const { start, end } of connections) {
    const p1 = landmarks[start];
    const p2 = landmarks[end];
    if (!p1 || !p2) continue;
    const a = toPixel(p1);
    const b = toPixel(p2);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

function drawFaceContours(ctx, landmarks, groups, toPixel) {
  const bold = 'rgba(255, 196, 60, 0.95)';
  const soft = 'rgba(255, 196, 60, 0.8)';
  drawContour(ctx, landmarks, groups.faceOval, toPixel, { color: bold, width: 3 });
  drawContour(ctx, landmarks, groups.leftEyebrow, toPixel, { color: soft, width: 2.5 });
  drawContour(ctx, landmarks, groups.rightEyebrow, toPixel, { color: soft, width: 2.5 });
  drawContour(ctx, landmarks, groups.leftEye, toPixel, { color: soft, width: 2.5 });
  drawContour(ctx, landmarks, groups.rightEye, toPixel, { color: soft, width: 2.5 });
  drawContour(ctx, landmarks, groups.lips, toPixel, { color: soft, width: 2.5 });
}

function drawCaliper(ctx, x1, x2, y, color, valueLabel) {
  const tick = (x2 - x1) * 0.08 + 5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.moveTo(x1, y - tick / 2);
  ctx.lineTo(x1, y + tick / 2);
  ctx.moveTo(x2, y - tick / 2);
  ctx.lineTo(x2, y + tick / 2);
  ctx.stroke();

  if (valueLabel) {
    const midX = (x1 + x2) / 2;
    const fontSize = Math.max(11, Math.round((x2 - x1) * 0.16));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = ctx.measureText(valueLabel).width;
    ctx.fillStyle = 'rgba(247, 245, 242, 0.88)';
    ctx.fillRect(midX - textW / 2 - 4, y - tick / 2 - fontSize - 6, textW + 8, fontSize + 4);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(valueLabel, midX, y - tick / 2 - fontSize / 2 - 4);
  }
}

/** 분석에 실제로 사용된 삼정 경계선·대칭축·눈코입 측정 구간을 사진 위에 그린다. */
function drawMeasurementLines(ctx, lines, toPixel, measurements, photoBox) {
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.strokeStyle = 'rgba(64, 40, 22, 0.9)';
  ctx.lineWidth = 2.5;

  // 삼정 경계선(눈썹 라인 / 코 밑선) — 얼굴 폭 전체에 가로선
  const bandLabels = { browLineY: null, noseBaseY: null };
  if (lines.samjeongLines && lines.faceOvalX) {
    for (const yKey of ['browLineY', 'noseBaseY']) {
      const yVal = lines.samjeongLines[yKey];
      if (yVal == null) continue;
      const { x1, x2 } = pixelSpanX(toPixel, lines.faceOvalX.minX, lines.faceOvalX.maxX, yVal);
      const py = toPixel({ x: lines.faceOvalX.minX, y: yVal }).y;
      ctx.beginPath();
      ctx.moveTo(x1, py);
      ctx.lineTo(x2, py);
      ctx.stroke();
      bandLabels[yKey] = py;
    }
  }

  // 좌우 대칭축(세로선)
  if (lines.centerAxis) {
    const top = toPixel({ x: lines.centerAxis.x, y: lines.centerAxis.topY });
    const bottom = toPixel({ x: lines.centerAxis.x, y: lines.centerAxis.bottomY });
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // 상정/중정/하정 라벨(사진 왼쪽 안쪽에 붙여서 표시)
  if (photoBox && bandLabels.browLineY != null && bandLabels.noseBaseY != null) {
    const zones = [
      { label: '상정', y: (photoBox.photoY + bandLabels.browLineY) / 2 },
      { label: '중정', y: (bandLabels.browLineY + bandLabels.noseBaseY) / 2 },
      { label: '하정', y: (bandLabels.noseBaseY + photoBox.photoY + photoBox.photoH) / 2 },
    ];
    ctx.font = `bold ${Math.max(12, Math.round(photoBox.photoW * 0.045))}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const zone of zones) {
      const tx = photoBox.photoX + 8;
      const tw = ctx.measureText(zone.label).width;
      ctx.fillStyle = 'rgba(64, 40, 22, 0.75)';
      ctx.fillRect(tx - 4, zone.y - 12, tw + 8, 24);
      ctx.fillStyle = '#f7f5f2';
      ctx.fillText(zone.label, tx, zone.y);
    }
  }

  // 눈·코·입 실측 구간(캘리퍼 + 실제 비율 수치)
  const spanConfigs = [
    { span: lines.eyeSpan, value: measurements?.eyeSpacingRatio, unit: '' },
    { span: lines.noseSpan, value: measurements?.noseWidthToFaceRatio, unit: '' },
    { span: lines.mouthSpan, value: measurements?.mouthWidthToNoseRatio, unit: '' },
  ];
  for (const { span, value } of spanConfigs) {
    if (!span) continue;
    const { x1, x2 } = pixelSpanX(toPixel, span.minX, span.maxX, span.y);
    const py = toPixel({ x: span.minX, y: span.y }).y;
    const label = value != null ? value.toFixed(2) : null;
    drawCaliper(ctx, x1, x2, py, PALETTE.accent, label);
  }
}

function drawCalloutGroup(ctx, items, toPixel, { innerX, align, maxWidth, topY, bottomY }) {
  if (!items.length) return;
  const step = items.length > 1 ? (bottomY - topY) / (items.length - 1) : 0;

  items.forEach((item, i) => {
    const anchorPx = toPixel(item.anchor);
    if (!anchorPx) return;
    const labelY = items.length > 1 ? topY + step * i : (topY + bottomY) / 2;

    ctx.strokeStyle = PALETTE.accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(anchorPx.x, anchorPx.y);
    ctx.lineTo(innerX, labelY);
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(anchorPx.x, anchorPx.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.accent;
    ctx.beginPath();
    ctx.arc(anchorPx.x, anchorPx.y, 5, 0, Math.PI * 2);
    ctx.fill();

    const fontSize = fitFontSize(ctx, item.label, maxWidth, Math.round(maxWidth * 0.13));
    ctx.font = `600 ${fontSize}px sans-serif`;
    ctx.fillStyle = PALETTE.text;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label, innerX, labelY);
  });
}

export function downloadCanvas(canvas, filename = 'face-analysis-report.png') {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
