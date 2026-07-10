// faceEngine.js
//
// MediaPipe Tasks Vision의 FaceLandmarker를 감싸는 래퍼.
// 모든 처리는 사용자 브라우저 안에서만 일어나며, 영상 프레임은 어디로도 전송되지 않는다.
// CDN에서 라이브러리/모델 파일을 최초 1회 내려받아 이후에는 브라우저 캐시를 사용한다.

const TASKS_VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_BASE_URL = `${TASKS_VISION_URL}/wasm`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let cachedModule = null;

async function loadTasksVisionModule() {
  if (!cachedModule) {
    cachedModule = await import(/* webpackIgnore: true */ `${TASKS_VISION_URL}/vision_bundle.mjs`);
  }
  return cachedModule;
}

export class FaceEngine {
  constructor() {
    this.landmarker = null;
  }

  async init(onProgress) {
    onProgress?.('얼굴 인식 모듈을 불러오는 중...');
    const { FaceLandmarker, FilesetResolver } = await loadTasksVisionModule();
    const filesetResolver = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

    onProgress?.('얼굴 인식 모델을 불러오는 중...');
    this.landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    this.FaceLandmarker = FaceLandmarker;
    return this;
  }

  /**
   * @param {HTMLVideoElement} videoEl
   * @param {number} timestampMs
   * @returns {{
   *   landmarks: {x:number,y:number,z:number}[],
   *   blendshapes: {categoryName:string, score:number}[]|null,
   *   pose: {yaw:number, pitch:number, roll:number}|null
   * } | null}
   */
  detectForVideo(videoEl, timestampMs) {
    if (!this.landmarker) return null;
    const result = this.landmarker.detectForVideo(videoEl, timestampMs);
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
      return null;
    }
    const landmarks = result.faceLandmarks[0];
    const blendshapes = result.faceBlendshapes?.[0]?.categories ?? null;
    let pose = null;
    const matrix = result.facialTransformationMatrixes?.[0]?.data;
    if (matrix) {
      pose = matrixToEulerDegrees(matrix);
    }
    return { landmarks, blendshapes, pose };
  }

  get landmarkGroups() {
    // 참고: tasks-vision은 눈/눈썹/입술/윤곽선 그룹은 제공하지만 "코" 전용 그룹은 제공하지
    // 않는다. 코 관련 측정은 measurements.js에서 전체 랜드마크 좌표로부터 기하학적으로
    // 근사한다.
    const FL = this.FaceLandmarker;
    return {
      lips: FL.FACE_LANDMARKS_LIPS,
      leftEye: FL.FACE_LANDMARKS_LEFT_EYE,
      rightEye: FL.FACE_LANDMARKS_RIGHT_EYE,
      leftEyebrow: FL.FACE_LANDMARKS_LEFT_EYEBROW,
      rightEyebrow: FL.FACE_LANDMARKS_RIGHT_EYEBROW,
      faceOval: FL.FACE_LANDMARKS_FACE_OVAL,
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
  }
}

/**
 * MediaPipe의 4x4 열우선(column-major) 얼굴 변환 행렬에서 yaw/pitch/roll(도 단위)을 계산한다.
 * 회전 행렬 R(3x3)로부터 표준적인 Tait-Bryan(Y-X-Z) 분해를 사용한다.
 */
function matrixToEulerDegrees(m) {
  // m은 length-16 열우선 배열. 3x3 회전 성분을 추출한다.
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r01 = m[4], r11 = m[5], r21 = m[6];
  const r02 = m[8], r12 = m[9], r22 = m[10];

  const yaw = Math.atan2(r02, r22);
  const pitch = Math.atan2(-r12, Math.sqrt(r02 * r02 + r22 * r22));
  const roll = Math.atan2(r10, r11);

  const toDeg = (rad) => (rad * 180) / Math.PI;
  return { yaw: toDeg(yaw), pitch: toDeg(pitch), roll: toDeg(roll) };
}
