// captureFlow.js
//
// 정면 → 좌우 회전(편한 방향 → 반대 방향) → 상하 기울임(편한 방향 → 반대 방향), 5단계로
// 고개를 움직이는 동안 실시간으로 자세(yaw/pitch)를 추정해, 목표 각도에 일정 시간 머무르면
// 자동으로 랜드마크 스냅샷을 캡처한다.
//
// 방향(왼쪽/오른쪽, 위/아래)을 미리 하나로 고정하지 않고 "처음 감지된 방향 → 반대 방향" 순서로
// 진행하는 이유: 카메라가 좌우반전(mirror)된 상태로 미리보기 되는 경우가 많고 기기·브라우저에 따라
// 좌우 표시가 달라질 수 있어, 화면상 왼쪽/오른쪽을 미리 단정하면 실제 동작과 안내 문구가 어긋날
// 위험이 있다. 대신 사용자가 실제로 움직인 방향을 기준으로 삼아 방향 표기 오류 없이 두 각도를 모두
// 확보한다.

const STEP_DEFS = [
  {
    key: 'front',
    instruction: '카메라를 정면으로 보고 편안하게 있어주세요',
    sub: '1 / 5 · 정면',
    isTarget: (pose) => Math.abs(pose.yaw) < 8 && Math.abs(pose.pitch) < 8,
    holdMs: 500,
  },
  {
    // 30도 기준으로도 머리카락에 가려 귀가 안 보인다는 실사용자 피드백을 받아 45도로 상향했으나,
    // 실제 원인은 각도가 아니라 정면 단계용 "더 가까이" 안내가 이 단계에도 그대로 걸려 있어
    // 카메라에 너무 가까운 채로 고개를 돌리다 보니 웹캠의 좁은 화각 밖으로 귀가 밀려난 것이었다
    // (main.js에서 close-up 안내를 front 단계로 한정해 수정). 카메라와 어느 정도 거리를 두어야
    // 고개를 돌렸을 때 귀까지 화면 안에 들어오므로, 안내 문구에도 이를 명시한다.
    key: 'turnA',
    instruction: '카메라와 한 걸음 거리를 두고, 거울 보듯 화면을 보면서 귀를 가리는 머리카락은 젖히고 귀가 뚜렷이 보일 때까지 고개를 옆으로 많이 돌려주세요',
    sub: '2 / 5 · 좌우 회전',
    isTarget: (pose) => Math.abs(pose.yaw) > 45,
    holdMs: 350,
  },
  {
    key: 'turnB',
    instruction: '이번에도 카메라와 거리를 유지한 채, 반대쪽 귀를 가리는 머리카락을 젖히고 반대 방향으로 고개를 많이 돌려주세요',
    sub: '3 / 5 · 좌우 회전 (반대)',
    isTarget: (pose, ctx) => Math.abs(pose.yaw) > 45 && Math.sign(pose.yaw) !== Math.sign(ctx.turnASign || 1),
    holdMs: 350,
  },
  {
    key: 'tiltA',
    instruction: '고개를 천천히 위나 아래로 기울여주세요',
    sub: '4 / 5 · 상하 기울임',
    isTarget: (pose) => Math.abs(pose.pitch) > 12,
    holdMs: 350,
  },
  {
    key: 'tiltB',
    instruction: '이번엔 반대 방향으로 천천히 기울여주세요',
    sub: '5 / 5 · 상하 기울임 (반대)',
    isTarget: (pose, ctx) => Math.abs(pose.pitch) > 12 && Math.sign(pose.pitch) !== Math.sign(ctx.tiltASign || 1),
    holdMs: 350,
  },
];

export class CaptureFlow {
  /**
   * @param {import('./faceEngine.js').FaceEngine} faceEngine
   * @param {HTMLVideoElement} videoEl
   * @param {{
   *   onFrame?: (info: {stepIndex:number, step:object, pose:object|null, holdRatio:number, faceDetected:boolean}) => void,
   *   onStepCaptured?: (stepKey:string, stepIndex:number) => void,
   *   onComplete?: (capturedPoses: Record<string, {landmarks:any[], blendshapes:any[]|null, pose:object}>) => void,
   * }} callbacks
   */
  constructor(faceEngine, videoEl, callbacks = {}) {
    this.faceEngine = faceEngine;
    this.videoEl = videoEl;
    this.callbacks = callbacks;
    this.running = false;
    this.stepIndex = 0;
    this.holdStart = null;
    this.captured = {};
    this.ctx = {};
    this._rafId = null;
  }

  start() {
    this.running = true;
    this.stepIndex = 0;
    this.holdStart = null;
    this.captured = {};
    this.ctx = {};
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._rafId != null) cancelAnimationFrame(this._rafId);
  }

  _loop() {
    if (!this.running) return;
    this._rafId = requestAnimationFrame(() => this._tick());
  }

  _tick() {
    if (!this.running) return;
    const video = this.videoEl;
    if (video.readyState < 2) {
      this._loop();
      return;
    }

    const now = performance.now();
    const result = this.faceEngine.detectForVideo(video, now);
    const step = STEP_DEFS[this.stepIndex];

    if (!result || !result.pose) {
      this.holdStart = null;
      this.callbacks.onFrame?.({ stepIndex: this.stepIndex, step, pose: null, holdRatio: 0, faceDetected: false, faceSizeRatio: null });
      this._loop();
      return;
    }

    const faceSizeRatio = estimateFaceSizeRatio(result.landmarks);
    const blinking = isBlinking(result.blendshapes);
    const inTarget = !blinking && step.isTarget(result.pose, this.ctx);

    if (inTarget) {
      if (this.holdStart == null) this.holdStart = now;
      const held = now - this.holdStart;
      const holdRatio = Math.min(1, held / step.holdMs);
      this.callbacks.onFrame?.({ stepIndex: this.stepIndex, step, pose: result.pose, holdRatio, faceDetected: true, faceSizeRatio });

      if (held >= step.holdMs) {
        this._captureStep(step, result);
      } else {
        this._loop();
      }
    } else {
      this.holdStart = null;
      this.callbacks.onFrame?.({ stepIndex: this.stepIndex, step, pose: result.pose, holdRatio: 0, faceDetected: true, faceSizeRatio });
      this._loop();
    }
  }

  _captureStep(step, result) {
    this.captured[step.key] = {
      landmarks: result.landmarks,
      blendshapes: result.blendshapes,
      pose: result.pose,
    };
    if (step.key === 'front' || step.key === 'turnA' || step.key === 'turnB') {
      // 인포그래픽(정면)과 귀 참고 사진(좌우 회전) 생성을 위해 이 시점의 프레임만 캡처한다.
      // 서버로 전송되지 않고, 화면에서 사용자가 직접 다운로드/저장하지 않는 한 브라우저
      // 메모리에만 존재한다.
      this.captured[step.key].photoDataUrl = capturePhoto(this.videoEl);
    }
    if (step.key === 'turnA') this.ctx.turnASign = Math.sign(result.pose.yaw) || 1;
    if (step.key === 'tiltA') this.ctx.tiltASign = Math.sign(result.pose.pitch) || 1;

    this.callbacks.onStepCaptured?.(step.key, this.stepIndex);
    this.holdStart = null;
    this.stepIndex += 1;

    if (this.stepIndex >= STEP_DEFS.length) {
      this.running = false;
      this.callbacks.onComplete?.(this.captured);
      return;
    }
    this._loop();
  }

  get steps() {
    return STEP_DEFS;
  }
}

/** 전체 랜드마크의 가로 폭(정규화 0~1)으로, 얼굴이 화면에서 차지하는 크기를 대략 추정한다. */
function estimateFaceSizeRatio(landmarks) {
  if (!landmarks || !landmarks.length) return null;
  let minX = Infinity, maxX = -Infinity;
  for (const p of landmarks) {
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  return Number.isFinite(minX) ? maxX - minX : null;
}

function capturePhoto(videoEl) {
  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function isBlinking(blendshapes) {
  if (!blendshapes) return false;
  const score = (name) => blendshapes.find((b) => b.categoryName === name)?.score ?? 0;
  return score('eyeBlinkLeft') > 0.6 || score('eyeBlinkRight') > 0.6;
}
