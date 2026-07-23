// hairEngine.js
//
// MediaPipe ImageSegmenter의 hair_segmenter 모델을 감싸는 래퍼. 정면 캡처 사진 한 장에만
// 1회 실행해 헤어라인(이마 시작선)의 y좌표를 추정한다 — faceEngine.js의 FaceLandmarker처럼
// 매 프레임 돌리지 않는다. 모든 처리는 사용자 브라우저 안에서만 일어나며, 이미지는 어디로도
// 전송되지 않는다.
//
// 카테고리 인덱스(1=머리카락으로 가정)는 공식 문서를 직접 열람하지 못한 상태에서
// 커뮤니티 자료를 근거로 확정한 값이다 — 실제 배포 환경에서 마스크를 시각적으로 검증할
// 필요가 있다. 검출이 애매하거나 실패하면 null을 반환하며, 호출부(measurements.js)는 이
// 경우 기존 방식(얼굴 윤곽 랜드마크 최상단)으로 되돌아간다.

const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_BASE_URL = `${TASKS_VISION_URL}/wasm`;
const HAIR_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/hair_segmenter/float32/1/hair_segmenter.tflite';

let cachedModule = null;
async function loadTasksVisionModule() {
  if (!cachedModule) {
    cachedModule = await import(/* webpackIgnore: true */ `${TASKS_VISION_URL}/vision_bundle.mjs`);
  }
  return cachedModule;
}

const HAIR_CATEGORY_INDEX = 1;
const HAIR_SCAN_BAND_RATIO = 0.02;
const HAIR_RATIO_THRESHOLD = 0.5;

/**
 * 카테고리 마스크(픽셀당 카테고리 인덱스가 담긴 1차원 배열)에서, 얼굴 중심 x열을 기준으로
 * 위에서 아래로 훑어 "머리카락 → 머리카락 아님(피부)"으로 바뀌는 첫 지점(헤어라인)의
 * 행(row)을 찾는다. 순수 함수라 실제 모델·이미지 없이도 합성 마스크로 검증할 수 있다.
 *
 * 한 개의 x열만 보면 잡음(엉킨 잔머리 한두 픽셀 등)에 취약하므로, 중심 좌우로 약간의
 * 밴드를 두고 "과반이 머리카락인지"로 판정한다. 이미지 맨 위가 곧바로 배경(머리 위 여백)일
 * 수 있으므로, 먼저 "머리카락이 시작되는 지점"을 찾은 뒤에야 "머리카락이 끝나는 지점"을
 * 헤어라인으로 인정한다 — 그렇지 않으면 머리 위 여백을 헤어라인으로 오인할 수 있다.
 *
 * @returns {number|null} 헤어라인 행(row index), 못 찾으면 null
 */
export function findHairlineRow(categoryData, width, height, centerX, {
  hairCategoryIndex = HAIR_CATEGORY_INDEX,
  bandRatio = HAIR_SCAN_BAND_RATIO,
  hairRatioThreshold = HAIR_RATIO_THRESHOLD,
} = {}) {
  const band = Math.max(1, Math.round(width * bandRatio));
  const hairRatioAtRow = (y) => {
    let hairCount = 0;
    let total = 0;
    for (let dx = -band; dx <= band; dx++) {
      const px = centerX + dx;
      if (px < 0 || px >= width) continue;
      total++;
      if (categoryData[y * width + px] === hairCategoryIndex) hairCount++;
    }
    return total > 0 ? hairCount / total : 0;
  };

  let hairStarted = false;
  for (let y = 0; y < height; y++) {
    const ratio = hairRatioAtRow(y);
    if (!hairStarted) {
      if (ratio >= hairRatioThreshold) hairStarted = true;
    } else if (ratio < hairRatioThreshold) {
      return y;
    }
  }
  return null;
}

export class HairEngine {
  constructor() {
    this.segmenter = null;
  }

  async init(onProgress) {
    onProgress?.('헤어라인 인식 모듈을 불러오는 중...');
    const { ImageSegmenter, FilesetResolver } = await loadTasksVisionModule();
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    this.segmenter = await ImageSegmenter.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: HAIR_MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    return this;
  }

  /**
   * @param {HTMLImageElement|HTMLCanvasElement} imageSource - 정면 캡처 이미지(1회만 호출)
   * @param {number} centerXRatio - 얼굴 중심 x좌표(0~1 정규화, measurements.js의 centerX와 같은 좌표계)
   * @returns {number|null} 헤어라인 y좌표(0~1 정규화), 검출 실패 시 null
   */
  detectHairlineY(imageSource, centerXRatio) {
    if (!this.segmenter) return null;
    const result = this.segmenter.segment(imageSource);
    const mask = result.categoryMask;
    if (!mask) {
      result.close?.();
      return null;
    }
    const width = mask.width;
    const height = mask.height;
    const data = mask.getAsUint8Array();
    const centerX = Math.round(centerXRatio * width);
    const row = findHairlineRow(data, width, height, centerX);
    mask.close?.();
    result.close?.();
    return row == null ? null : row / height;
  }

  close() {
    this.segmenter?.close();
    this.segmenter = null;
  }
}
