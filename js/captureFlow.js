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

// axis/threshold: isTarget과 별개로, 촬영 화면에서 "목표 각도까지 얼마나 왔는지"를 실시간
// 막대로 보여주기 위한 값이다(main.js). 실사용자 피드백("왼쪽은 바로 소리가 나는데 오른쪽은
// 소리가 안 나서 고개를 여러 번 흔들게 된다")을 받아 원인을 찾아보니, turnB는 turnA가 끝난
// 시점의 각도(예: +50°)에서 반대 부호로 45°를 넘겨야 하므로 총 회전 폭이 90도 이상으로
// turnA(0→45°)보다 훨씬 크다 — 그런데 화면에는 목표에 도달하기 전까지 진행 상황을 보여주는
// 표시가 전혀 없어서(hold-ring은 "목표에 도달한 뒤 유지한 시간"만 보여줌), 사용자가 얼마나 더
// 돌려야 하는지 알 수 없어 감으로 여러 번 시도하게 되는 것이 실제 원인으로 보인다. 이를
// 고치기 위해 목표각 대비 현재각 비율을 별도로 노출한다.
const STEP_DEFS = [
  {
    key: 'front',
    instruction: '카메라를 정면으로 보고 편안하게 있어주세요',
    sub: '1 / 5 · 정면',
    isTarget: (pose) => Math.abs(pose.yaw) < 8 && Math.abs(pose.pitch) < 8,
    holdMs: 500,
    axis: null,
    threshold: null,
  },
  {
    // 30도 기준으로도 머리카락에 가려 귀가 안 보인다는 실사용자 피드백을 받아 45도로 상향했으나,
    // 실제 원인은 각도가 아니라 정면 단계용 "더 가까이" 안내가 이 단계에도 그대로 걸려 있어
    // 카메라에 너무 가까운 채로 고개를 돌리다 보니 웹캠의 좁은 화각 밖으로 귀가 밀려난 것이었다
    // (main.js에서 close-up 안내를 front 단계로 한정해 수정). 카메라와 어느 정도 거리를 두어야
    // 고개를 돌렸을 때 귀까지 화면 안에 들어오므로, 안내 문구에도 이를 명시한다.
    // 예전에는 거리·거울보기·머리카락·회전까지 네 가지 지시를 한 문장에 욱여넣어 촬영 중
    // 한눈에 읽기 어려웠다. 핵심 동작(고개를 옆으로 돌리기)만 instruction에 남기고, 거리·
    // 머리카락 같은 보조 팁은 UI에서 별도 줄로 이미 노출되는 sub로 옮겼다.
    key: 'turnA',
    instruction: '거울 보듯 화면을 보면서, 귀가 뚜렷이 보일 때까지 고개를 옆으로 많이 돌려주세요',
    sub: '2 / 5 · 좌우 회전 · 카메라와 한 걸음 거리 유지, 귀 가리는 머리카락 젖히기',
    isTarget: (pose) => Math.abs(pose.yaw) > 45,
    holdMs: 350,
    axis: 'yaw',
    threshold: 45,
  },
  {
    key: 'turnB',
    instruction: '이번엔 반대쪽으로 고개를 많이 돌려주세요',
    sub: '3 / 5 · 좌우 회전 (반대) · 거리 유지, 반대쪽 귀 가리는 머리카락 젖히기',
    isTarget: (pose, ctx) => Math.abs(pose.yaw) > 45 && Math.sign(pose.yaw) !== Math.sign(ctx.turnASign || 1),
    holdMs: 350,
    axis: 'yaw',
    threshold: 45,
  },
  {
    key: 'tiltA',
    instruction: '고개를 천천히 위나 아래로 기울여주세요',
    sub: '4 / 5 · 상하 기울임',
    isTarget: (pose) => Math.abs(pose.pitch) > 12,
    holdMs: 350,
    axis: 'pitch',
    threshold: 12,
  },
  {
    key: 'tiltB',
    instruction: '이번엔 반대 방향으로 천천히 기울여주세요',
    sub: '5 / 5 · 상하 기울임 (반대)',
    isTarget: (pose, ctx) => Math.abs(pose.pitch) > 12 && Math.sign(pose.pitch) !== Math.sign(ctx.tiltASign || 1),
    holdMs: 350,
    axis: 'pitch',
    threshold: 12,
  },
];

// "좌우 귀 촬영 인식이 잘 안 된다"는 재보고를 받고 _tick()을 다시 살펴보다 발견한 문제:
// 목표 각도(특히 turnA/turnB의 45도 이상)에서는 옆모습이라 랜드마크가 일부 가려지고,
// 고개를 실제로 돌리는 동작 자체가 모션 블러를 만들어 프레임마다 pose 추정값이 흔들리거나
// (경계값 45도 언저리를 오르내림) MediaPipe가 한두 프레임 동안 아예 pose를 못 내놓는 일이
// 흔하다. 그런데 기존 코드는 "목표를 벗어난 단 한 프레임"만으로 holdStart를 즉시 null로
// 되돌려 350ms 연속 유지를 처음부터 다시 요구했다 — 사용자가 실제로 각도를 잘 유지하고
// 있어도 홀드 링이 채워지다 말다를 반복하며 좀처럼 완료되지 않는 체감으로 이어진다. 각도
// 임계값(45도)이나 close-up 안내 범위, 화면비 문제는 이미 이전 라운드들에서 검증·수정된
// 사항이라 다시 건드리지 않고, 이번엔 짧은 끊김을 흡수하는 유예 시간을 둔다.
const TRACKING_GRACE_MS = 250;

export class CaptureFlow {
  /**
   * @param {import('./faceEngine.js').FaceEngine} faceEngine
   * @param {HTMLVideoElement} videoEl
   * @param {{
   *   onFrame?: (info: {stepIndex:number, step:object, pose:object|null, holdRatio:number, faceDetected:boolean}) => void,
   *   onStepCaptured?: (stepKey:string, stepIndex:number, info:{photoDataUrl:string, screenSide:('left'|'right'|null), screenDir:('up'|'down'|null)}) => void,
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
    this.lastInTargetAt = null;
    this.captured = {};
    this.ctx = {};
    this._rafId = null;
    // STEP_DEFS는 모듈 전역 상수라서 인스턴스끼리 공유된다. _captureStep이 실제 감지된
    // 방향에 맞춰 instruction/sub 문구를 그 자리에서 고쳐 쓰기 때문에(turnA→turnB,
    // tiltA→tiltB), 공유 배열을 그대로 두면 이전 세션에서 남은 문구가 다음 세션 시작
    // 시점에 아직 남아있는 상태로 노출될 수 있다(예: 방향 판정에 실패해 재작성이 안 되는
    // 경로가 생기는 경우). 인스턴스마다 얕은 복제본을 만들어 이 문제를 원천 차단한다.
    this.stepDefs = STEP_DEFS.map((s) => ({ ...s }));
  }

  start() {
    this.running = true;
    this.stepIndex = 0;
    this.holdStart = null;
    this.lastInTargetAt = null;
    this.captured = {};
    this.ctx = {};
    // 매 세션 시작 시 원본(STEP_DEFS)에서 다시 복제해, 이전 세션이 덮어썼을 수 있는
    // instruction/sub 문구를 초기 상태로 리셋한다.
    this.stepDefs = STEP_DEFS.map((s) => ({ ...s }));
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
    const step = this.stepDefs[this.stepIndex];

    if (!result) {
      // 랜드마크 자체가 안 잡힌 경우(얼굴이 화면에 없거나 완전히 가려짐)에만 "얼굴 인식 안 됨"
      // 신호를 보낸다 — faceDetected:false는 main.js의 3초 후 no-face-hint 노출로 이어지므로,
      // 아래(랜드마크는 있지만 pose 행렬만 잠깐 비는 경우)와는 구분해야 오인 안내를 피한다.
      this._registerMiss(now);
      this.callbacks.onFrame?.({ stepIndex: this.stepIndex, step, pose: null, holdRatio: this._holdRatio(step, now), faceDetected: false, faceSizeRatio: null });
      this._loop();
      return;
    }

    const faceSizeRatio = estimateFaceSizeRatio(result.landmarks);

    if (!result.pose) {
      // 랜드마크는 잡혔는데 자세 추정(facialTransformationMatrix)만 비는 경우 — 옆모습에
      // 가까운 각도에서 한두 프레임 정도 흔히 발생한다(아래 TRACKING_GRACE_MS 설명 참고).
      // 얼굴 자체는 인식되고 있으므로 faceDetected는 true로 보고한다.
      this._registerMiss(now);
      this.callbacks.onFrame?.({ stepIndex: this.stepIndex, step, pose: null, holdRatio: this._holdRatio(step, now), faceDetected: true, faceSizeRatio });
      this._loop();
      return;
    }

    const blinking = isBlinking(result.blendshapes);
    const inTarget = !blinking && step.isTarget(result.pose, this.ctx);

    if (inTarget) {
      if (this.holdStart == null) this.holdStart = now;
      this.lastInTargetAt = now;
      const held = now - this.holdStart;
      const holdRatio = Math.min(1, held / step.holdMs);
      this.callbacks.onFrame?.({ stepIndex: this.stepIndex, step, pose: result.pose, holdRatio, faceDetected: true, faceSizeRatio, ctx: this.ctx });

      if (held >= step.holdMs) {
        this._captureStep(step, result);
      } else {
        this._loop();
      }
    } else {
      this._registerMiss(now);
      this.callbacks.onFrame?.({ stepIndex: this.stepIndex, step, pose: result.pose, holdRatio: this._holdRatio(step, now), faceDetected: true, faceSizeRatio, ctx: this.ctx });
      this._loop();
    }
  }

  // TRACKING_GRACE_MS 안에 목표 자세로 돌아오면 holdStart를 그대로 둬서, 짧은 끊김/흔들림
  // 동안 지나간 시간도 누적 유지 시간에서 거의 보존되게 한다. 유예 시간을 넘겨서도 계속
  // 벗어나 있으면 그때 가서 holdStart를 비워 처음부터 다시 측정한다.
  _registerMiss(now) {
    if (this.holdStart == null) return;
    if (this.lastInTargetAt != null && now - this.lastInTargetAt > TRACKING_GRACE_MS) {
      this.holdStart = null;
      this.lastInTargetAt = null;
    }
  }

  _holdRatio(step, now) {
    if (this.holdStart == null) return 0;
    return Math.min(1, (now - this.holdStart) / step.holdMs);
  }

  _captureStep(step, result) {
    this.captured[step.key] = {
      landmarks: result.landmarks,
      blendshapes: result.blendshapes,
      pose: result.pose,
    };
    // 5단계 모두 이 순간의 프레임을 캡처해둔다 — 촬영 화면의 필름스트립(단계별 캡처 미리보기)에
    // 그대로 보여줘서 "이 단계가 실제로 찍혔는지" 사용자가 눈으로 확인할 수 있게 하기 위함이다.
    // 서버로 전송되지 않고, 화면에서 사용자가 직접 다운로드하지 않는 한 브라우저 메모리에만 존재한다.
    // 이 중 정면·좌우 회전 사진만 인포그래픽·귀 참고 사진에 실제로 쓰인다.
    this.captured[step.key].photoDataUrl = capturePhoto(this.videoEl);

    let screenSide = null;
    let screenDir = null;
    if (step.key === 'turnA' || step.key === 'turnB') {
      screenSide = estimateScreenSide(this.captured.front?.landmarks, result.landmarks);
      this.captured[step.key].screenSide = screenSide;
    }
    if (step.key === 'tiltA' || step.key === 'tiltB') {
      screenDir = estimateScreenTiltDir(this.captured.front?.landmarks, result.landmarks);
      this.captured[step.key].screenDir = screenDir;
    }

    if (step.key === 'turnA') {
      this.ctx.turnASign = Math.sign(result.pose.yaw) || 1;
      // 실제로 감지된 방향을 알게 됐으니, 다음 단계(반대 방향) 안내 문구를 "반대 방향" 같은
      // 추상적 표현 대신 구체적으로 왼쪽/오른쪽으로 명시해 업데이트한다.
      if (screenSide) {
        const other = screenSide === 'left' ? '오른쪽' : '왼쪽';
        this.stepDefs[2].instruction = `${other}으로 고개를 많이 돌려주세요`;
        this.stepDefs[2].sub = `3 / 5 · 좌우 회전 (${other}) · 거리 유지, 귀 가리는 머리카락 젖히기`;
      }
    }
    if (step.key === 'tiltA') {
      this.ctx.tiltASign = Math.sign(result.pose.pitch) || 1;
      if (screenDir) {
        const other = screenDir === 'up' ? '아래' : '위';
        this.stepDefs[4].instruction = `이번엔 ${other} 방향으로 천천히 기울여주세요`;
        this.stepDefs[4].sub = `5 / 5 · 상하 기울임 (${other})`;
      }
    }

    this.callbacks.onStepCaptured?.(step.key, this.stepIndex, {
      photoDataUrl: this.captured[step.key].photoDataUrl,
      screenSide,
      screenDir,
    });
    this.holdStart = null;
    this.lastInTargetAt = null;
    this.stepIndex += 1;

    if (this.stepIndex >= this.stepDefs.length) {
      this.running = false;
      this.callbacks.onComplete?.(this.captured);
      return;
    }
    this._loop();
  }

  get steps() {
    return this.stepDefs;
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

// MediaPipe FaceLandmarker의 478점 토폴로지에서 인덱스 1은 코끝(nose tip)으로 고정돼 있다 —
// 별도 "코" 랜드마크 그룹은 없지만(faceEngine.js 주석 참고) 개별 인덱스 접근은 항상 가능하다.
const NOSE_TIP_INDEX = 1;

/**
 * 정면(front) 캡처 시점의 코끝 x좌표를 기준으로, 좌우 회전 캡처 시점에 코끝이 원본(비반전)
 * 프레임에서 어느 쪽으로 이동했는지를 보고 "미리보기 화면에서" 어느 방향으로 보이는지를
 * 판정한다. 미리보기는 좌우반전(scaleX(-1))되어 있으므로, 원본 프레임에서 코끝 x가 작아지는
 * 방향(왼쪽 이동)은 반전된 미리보기에서는 오른쪽으로 보인다 — 즉 사용자가 실제로 자신의
 * 오른쪽으로 고개를 돌렸을 때의 결과와 일치한다.
 */
function estimateScreenSide(frontLandmarks, currentLandmarks) {
  const a = frontLandmarks?.[NOSE_TIP_INDEX];
  const b = currentLandmarks?.[NOSE_TIP_INDEX];
  if (!a || !b) return null;
  return b.x < a.x ? 'right' : 'left';
}

/**
 * 상하 기울임은 미리보기에서 세로 방향을 반전하지 않으므로(scaleX만 적용), 이미지 좌표계
 * 그대로 비교한다 — y가 작아지면(위로 이동) 화면에서도 위로 기운 것으로 보인다.
 */
function estimateScreenTiltDir(frontLandmarks, currentLandmarks) {
  const a = frontLandmarks?.[NOSE_TIP_INDEX];
  const b = currentLandmarks?.[NOSE_TIP_INDEX];
  if (!a || !b) return null;
  return b.y < a.y ? 'up' : 'down';
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
