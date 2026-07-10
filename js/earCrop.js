// earCrop.js
//
// 좌우 회전(turnA/turnB) 촬영 프레임에서 "귀 높이" 대역(눈썹~입술 사이)을 이미지 전체
// 너비로 크롭한다. 어느 쪽으로 고개를 돌렸는지에 따라 노출되는 귀가 좌/우 어느 쪽인지
// 미리 단정하지 않고, 전체 너비를 그대로 잘라내어 사용자가 직접 보고 확인하게 한다.
// (자동으로 귀 모양을 측정·판정하지 않음 — 참고용 사진 + 자가진단 체크리스트만 제공)

import { indicesFromConnections, bbox } from './measurements.js';

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    img.src = dataUrl;
  });
}

/**
 * @param {string} photoDataUrl - 캡처된 원본 프레임(비반전)
 * @param {any[]} landmarks - 같은 시점의 랜드마크
 * @param {object} groups - faceEngine.landmarkGroups
 * @returns {Promise<HTMLCanvasElement|null>} 크롭된 캔버스, 랜드마크가 없으면 null
 */
export async function cropEarBand(photoDataUrl, landmarks, groups) {
  if (!photoDataUrl || !landmarks) return null;

  const img = await loadImage(photoDataUrl);
  const w = img.naturalWidth;
  const h = img.naturalHeight;

  const browIdx = [
    ...indicesFromConnections(groups.leftEyebrow),
    ...indicesFromConnections(groups.rightEyebrow),
  ];
  const lipsIdx = indicesFromConnections(groups.lips);
  const browBox = bbox(landmarks, browIdx);
  const lipsBox = bbox(landmarks, lipsIdx);
  if (!Number.isFinite(browBox.minY) || !Number.isFinite(lipsBox.minY)) return null;

  const padding = 0.05; // 위아래 여유
  const yTopNorm = Math.max(0, browBox.minY - padding);
  const yBottomNorm = Math.min(1, lipsBox.minY + padding);
  const sy = yTopNorm * h;
  const sh = Math.max(1, (yBottomNorm - yTopNorm) * h);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');

  // 미리보기와 같은 방향(좌우 반전)으로 그린다.
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, sy, w, sh, 0, 0, w, sh);
  ctx.restore();

  return canvas;
}
