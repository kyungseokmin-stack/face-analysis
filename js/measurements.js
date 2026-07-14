// measurements.js
//
// 캡처된 랜드마크(정면/좌/우/위/아래)로부터 관상 해석에 쓰일 기하학적 비율을 계산한다.
// MediaPipe FaceLandmarker가 제공하는 정규화 좌표(x,y ∈ [0,1], z는 얼굴 중심 기준 상대 깊이)를 사용한다.
// 여기서 산출되는 값은 모두 "근사치"이며, 정밀 의료/생체측정이 아닌 문화적 해석을 위한 참고용 지표다.

export function indicesFromConnections(connections) {
  const set = new Set();
  for (const c of connections) {
    set.add(c.start);
    set.add(c.end);
  }
  return [...set];
}

export function bbox(landmarks, indices) {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let sumZ = 0, count = 0;
  for (const i of indices) {
    const p = landmarks[i];
    if (!p) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
    sumZ += p.z;
    count++;
  }
  return {
    minX, maxX, minY, maxY, minZ, maxZ,
    width: maxX - minX,
    height: maxY - minY,
    depth: maxZ - minZ,
    avgZ: count ? sumZ / count : 0,
  };
}

function centroid(landmarks, indices) {
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const i of indices) {
    const p = landmarks[i];
    if (!p) continue;
    sx += p.x; sy += p.y; sz += p.z; n++;
  }
  return n ? { x: sx / n, y: sy / n, z: sz / n } : null;
}

function stdevY(landmarks, indices) {
  const ys = [...indices].map((i) => landmarks[i]?.y).filter((y) => y != null);
  if (ys.length < 2) return 0;
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  const variance = ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length;
  return Math.sqrt(variance);
}

/** 점 p에서 직선 a-b까지의 2D(x,y) 수선의 발 거리. */
function pointToLineDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lineLenSq = dx * dx + dy * dy;
  if (lineLenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lineLenSq;
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

// 고개를 이 각도(도) 이상 돌린 프레임(turnA/turnB)에서만 옆모습 기반 코 돌출도를 계산한다.
// captureFlow.js가 turnA/turnB를 |yaw|>=45도에서 캡처하므로 대부분 이 조건을 만족하지만,
// 여유를 두어 30도로 잡았다.
const PROFILE_YAW_MIN_DEGREES = 30;

/** y값 범위 [yMin, yMax] (0=이마쪽, 1=턱쪽, 상대비율) 안에 있는 faceOval 점들의 x폭을 구한다. */
function widthInYBand(landmarks, ovalIndices, ovalBox, yMinRatio, yMaxRatio) {
  const yMin = ovalBox.minY + ovalBox.height * yMinRatio;
  const yMax = ovalBox.minY + ovalBox.height * yMaxRatio;
  let minX = Infinity, maxX = -Infinity;
  for (const i of ovalIndices) {
    const p = landmarks[i];
    if (!p) continue;
    if (p.y >= yMin && p.y <= yMax) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
  }
  if (minX === Infinity) return null;
  return maxX - minX;
}

/** 전체 랜드마크 중 지정한 x/y 범위 안에 있는 점들의 인덱스 목록을 반환한다. */
function indicesInBand(landmarks, { yMin, yMax, xMin, xMax }) {
  const out = [];
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (!p) continue;
    if (p.y >= yMin && p.y <= yMax && p.x >= xMin && p.x <= xMax) out.push(i);
  }
  return out;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function average(nums) {
  const valid = nums.filter((n) => n != null && Number.isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/**
 * 단일 포즈(랜드마크 1세트)로부터 1차 지표를 계산한다.
 * 실패 가능(랜드마크 누락)하므로 호출부에서 null 체크가 필요하다.
 */
function computeSinglePoseMetrics(landmarks, groups, pose) {
  if (!landmarks) return null;

  const ovalIdx = indicesFromConnections(groups.faceOval);
  const leftEyeIdx = indicesFromConnections(groups.leftEye);
  const rightEyeIdx = indicesFromConnections(groups.rightEye);
  const leftBrowIdx = indicesFromConnections(groups.leftEyebrow);
  const rightBrowIdx = indicesFromConnections(groups.rightEyebrow);
  const lipsIdx = indicesFromConnections(groups.lips);

  const ovalBox = bbox(landmarks, ovalIdx);
  const faceWidth = ovalBox.width;
  const faceHeight = ovalBox.height;
  if (!faceWidth || !faceHeight) return null;

  const leftEyeBox = bbox(landmarks, leftEyeIdx);
  const rightEyeBox = bbox(landmarks, rightEyeIdx);
  const leftBrowBox = bbox(landmarks, leftBrowIdx);
  const rightBrowBox = bbox(landmarks, rightBrowIdx);
  const lipsBox = bbox(landmarks, lipsIdx);

  const browLineY = average([leftBrowBox.minY, rightBrowBox.minY]);
  // 눈 아래쪽 경계(하안검) 아래부터를 "코 영역 후보"로 본다 — 눈 상단(minY)을 기준으로 삼으면
  // 눈 안쪽 점(내안각)이 코 영역에 섞여 들어올 수 있어, 눈의 가장 아래쪽(maxY)을 기준으로 한다.
  const eyeBottomY = average([leftEyeBox.maxY, rightEyeBox.maxY]);

  // MediaPipe FaceLandmarker는 눈썹/눈/입/윤곽선과 달리 "코" 전용 랜드마크 그룹을 별도로
  // 제공하지 않는다. 대신 전체 랜드마크(478점) 중 눈 아래~윗입술 사이, 얼굴 중앙 부근에
  // 있는 점들을 코 영역으로 간주해 폭/깊이를 근사한다.
  const centerX = ovalBox.minX + faceWidth / 2;
  // 실사용자 테스트에서 이 x범위가 ±0.25*faceWidth였을 때 코 너비가 얼굴 너비의 절반(0.5)
  // 가까이 측정되는 버그가 발견됐다(해부학적으로 코 너비는 보통 얼굴 너비의 20~25% 수준).
  // MediaPipe의 478개 랜드마크는 얼굴 전체에 촘촘히 분포하므로, 범위가 넓으면 볼·팔자주름
  // 부근 점까지 "코"로 잡혀 폭이 과대 측정된다. ±0.13으로 좁혀 콧망울 부근만 포착한다.
  const noseBandIdx = indicesInBand(landmarks, {
    yMin: eyeBottomY + faceHeight * 0.025, // 눈 하단 경계 점이 섞여 들어오지 않도록 약간의 여유를 둔다
    yMax: lipsBox.minY,
    xMin: centerX - faceWidth * 0.13,
    xMax: centerX + faceWidth * 0.13,
  });
  const noseBox = noseBandIdx.length ? bbox(landmarks, noseBandIdx) : null;
  const noseBaseY = noseBox ? noseBox.maxY : eyeBottomY + faceHeight * 0.14;

  // --- 삼정(三停) ---
  const upperH = clamp(browLineY - ovalBox.minY, 0, faceHeight);
  const middleH = clamp(noseBaseY - browLineY, 0, faceHeight);
  const lowerH = clamp(ovalBox.maxY - noseBaseY, 0, faceHeight);
  const totalH = upperH + middleH + lowerH || faceHeight;
  const samjeongRatios = {
    upper: upperH / totalH,
    middle: middleH / totalH,
    lower: lowerH / totalH,
  };

  // --- 눈썹 ---
  const browWidth = average([leftBrowBox.width, rightBrowBox.width]);
  const eyeWidth = average([leftEyeBox.width, rightEyeBox.width]);
  const eyebrowLengthToEyeRatio = eyeWidth ? browWidth / eyeWidth : null;
  const browThicknessRatio = average([
    leftBrowBox.width ? leftBrowBox.height / leftBrowBox.width : null,
    rightBrowBox.width ? rightBrowBox.height / rightBrowBox.width : null,
  ]);
  const browArchHeight = average([
    leftBrowBox.width ? stdevY(landmarks, leftBrowIdx) / leftBrowBox.width : null,
    rightBrowBox.width ? stdevY(landmarks, rightBrowIdx) / rightBrowBox.width : null,
  ]);

  // --- 눈 ---
  const eyeApertureRatio = average([
    leftEyeBox.width ? leftEyeBox.height / leftEyeBox.width : null,
    rightEyeBox.width ? rightEyeBox.height / rightEyeBox.width : null,
  ]);
  const eyeWidthToFaceRatio = eyeWidth ? eyeWidth / faceWidth : null;
  const leftEyeCenter = centroid(landmarks, leftEyeIdx);
  const rightEyeCenter = centroid(landmarks, rightEyeIdx);
  let eyeSpacingRatio = null;
  if (leftEyeCenter && rightEyeCenter && eyeWidth) {
    const centerDist = Math.hypot(leftEyeCenter.x - rightEyeCenter.x, leftEyeCenter.y - rightEyeCenter.y);
    const gapEstimate = centerDist - eyeWidth;
    eyeSpacingRatio = gapEstimate / eyeWidth;
  }

  // --- 코 ---
  const noseWidth = noseBox ? noseBox.width : null;
  const noseWidthToFaceRatio = noseWidth ? noseWidth / faceWidth : null;
  const noseLengthToFaceRatio = noseBox ? (noseBaseY - browLineY) / faceHeight : null;
  let noseProminence = null;
  if (noseBox) {
    const cheekAvgZ = ovalBox.avgZ;
    const noseTipZ = noseBox.minZ; // 카메라에 더 가까울수록 z가 작음(더 음수)
    const raw = cheekAvgZ - noseTipZ; // 코가 돌출될수록 양수
    // 배율(9)은 실측 보정치가 아니라, 정규화된 z값의 실제 변동폭이 작아 값이 0.5 부근에
    // 몰리는 것을 완화하기 위해 늘린 근사 계수다(문헌·의료 데이터 기반 아님).
    noseProminence = clamp(0.5 + (raw / faceWidth) * 9, 0, 1);
  }

  // --- 코 돌출도(옆모습 기반) ---
  // 정면 사진만으로는 MediaPipe가 추정하는 z(깊이)값의 오차가 커서, 실제로는 코가 낮은
  // 사람도 "매우 높음"으로 나오는 문제가 있었다. 고개를 45도 이상 돌린 옆모습에서는 코의
  // 실제 돌출이 이미지의 x/y 평면 위로 충분히 드러나므로, 그 각도에서는 z 대신 순수 기하로
  // 계산한다 — 이마 위쪽 끝과 턱 아래쪽 끝을 잇는 "얼굴 옆선"에서 코끝(랜드마크 1)이 얼마나
  // 벗어나 있는지를 재는데, 이는 전통적으로 옆모습 사진에서 콧대 높이를 가늠하는 방식과 같다.
  let noseProminenceProfile = null;
  if (pose && Math.abs(pose.yaw) >= PROFILE_YAW_MIN_DEGREES) {
    const noseTip = landmarks[1];
    let topPt = null, bottomPt = null;
    for (const i of ovalIdx) {
      const p = landmarks[i];
      if (!p) continue;
      if (!topPt || p.y < topPt.y) topPt = p;
      if (!bottomPt || p.y > bottomPt.y) bottomPt = p;
    }
    if (noseTip && topPt && bottomPt) {
      const lineLen = Math.hypot(bottomPt.x - topPt.x, bottomPt.y - topPt.y);
      if (lineLen > 0) {
        const raw = pointToLineDistance(noseTip, topPt, bottomPt) / lineLen;
        // 회전각이 클수록 실제 돌출이 화면에 더 많이 드러나므로(sin(각도)에 비례), 다시
        // 나눠 "정면 기준 돌출 비율"과 같은 스케일로 되돌린다.
        const depthEquivalent = raw / Math.sin((Math.abs(pose.yaw) * Math.PI) / 180);
        // 성인 옆모습에서 코끝~이마-턱 선 사이 거리는 대략 얼굴 길이의 6~7% 정도가 "보통"
        // 수준으로 알려져 있다(문헌·의료 실측 데이터는 아닌 일반적 안면 비례 근사치). 이를
        // 중간값(0.5)에 맞추고 배율을 곱해 0~1 범위로 펼친다.
        noseProminenceProfile = clamp(0.5 + (depthEquivalent - 0.065) * 6, 0, 1);
      }
    }
  }

  // --- 입 ---
  const mouthWidth = lipsBox.width;
  const mouthWidthToNoseRatio = noseWidth ? mouthWidth / noseWidth : null;
  const mouthWidthToFaceRatio = mouthWidth / faceWidth;

  // --- 얼굴형 분류용 폭 밴드 ---
  const foreheadBandWidth = widthInYBand(landmarks, ovalIdx, ovalBox, 0.0, 0.15);
  const cheekBandWidth = widthInYBand(landmarks, ovalIdx, ovalBox, 0.35, 0.55);
  const jawBandWidth = widthInYBand(landmarks, ovalIdx, ovalBox, 0.75, 0.95);
  const chinTipWidth = widthInYBand(landmarks, ovalIdx, ovalBox, 0.9, 1.0);

  const widthToHeightRatio = faceWidth / faceHeight;
  const foreheadToCheekRatio = cheekBandWidth ? (foreheadBandWidth ?? 0) / cheekBandWidth : null;
  const jawToCheekRatio = cheekBandWidth ? (jawBandWidth ?? 0) / cheekBandWidth : null;
  const jawAngleSharpness = jawBandWidth ? clamp(1 - (chinTipWidth ?? 0) / jawBandWidth, 0, 1) : null;

  // --- 좌우 대칭(오악 균형용) ---
  const cheekYMin = ovalBox.minY + faceHeight * 0.35;
  const cheekYMax = ovalBox.minY + faceHeight * 0.55;
  let leftExtent = 0, rightExtent = 0;
  let leftCheekPoint = null, rightCheekPoint = null;
  for (const i of ovalIdx) {
    const p = landmarks[i];
    if (!p || p.y < cheekYMin || p.y > cheekYMax) continue;
    if (p.x < centerX) {
      const d = centerX - p.x;
      if (d > leftExtent) { leftExtent = d; leftCheekPoint = { x: p.x, y: p.y }; }
    } else {
      const d = p.x - centerX;
      if (d > rightExtent) { rightExtent = d; rightCheekPoint = { x: p.x, y: p.y }; }
    }
  }
  const cheekBalance = faceWidth ? (leftExtent - rightExtent) / faceWidth : null;

  // --- 인포그래픽 콜아웃용 대표 좌표(정규화 좌표, 0~1) ---
  const eyebrowCentroid = centroid(landmarks, [...leftBrowIdx, ...rightBrowIdx]);
  const eyeCentroid = centroid(landmarks, [...leftEyeIdx, ...rightEyeIdx]);
  const mouthCentroid = centroid(landmarks, lipsIdx);
  const anchors = {
    forehead: { x: centerX, y: ovalBox.minY + faceHeight * 0.06 },
    eyebrow: eyebrowCentroid ? { x: eyebrowCentroid.x, y: eyebrowCentroid.y } : null,
    eye: eyeCentroid ? { x: eyeCentroid.x, y: eyeCentroid.y } : null,
    nose: noseBox ? { x: (noseBox.minX + noseBox.maxX) / 2, y: (noseBox.minY + noseBox.maxY) / 2 } : null,
    mouth: mouthCentroid ? { x: mouthCentroid.x, y: mouthCentroid.y } : null,
    chin: { x: centerX, y: ovalBox.maxY - faceHeight * 0.03 },
    leftCheek: leftCheekPoint,
    rightCheek: rightCheekPoint,
  };

  // --- 인포그래픽에 "측정선"을 그리기 위한 좌표 ---
  // 삼정 경계선(눈썹 라인·코 밑선)과 좌우 대칭축, 눈·코·입을 측정한 너비 구간을
  // 그대로 노출해, 리포트가 어떤 지점을 근거로 만들어졌는지 시각적으로 보여준다.
  const measurementLines = {
    faceOvalX: { minX: ovalBox.minX, maxX: ovalBox.maxX },
    samjeongLines: { browLineY, noseBaseY },
    centerAxis: { x: centerX, topY: ovalBox.minY, bottomY: ovalBox.maxY },
    eyeSpan: leftEyeCenter && rightEyeCenter
      ? { minX: leftEyeBox.minX, maxX: rightEyeBox.maxX, y: (leftEyeBox.minY + rightEyeBox.minY) / 2 }
      : null,
    noseSpan: noseBox ? { minX: noseBox.minX, maxX: noseBox.maxX, y: noseBox.maxY } : null,
    mouthSpan: { minX: lipsBox.minX, maxX: lipsBox.maxX, y: mouthCentroid ? mouthCentroid.y : lipsBox.minY },
  };

  return {
    faceWidth,
    faceHeight,
    anchors,
    measurementLines,
    samjeongRatios,
    eyebrowLengthToEyeRatio,
    browThicknessRatio,
    browArchHeight,
    eyeApertureRatio,
    eyeWidthToFaceRatio,
    eyeSpacingRatio,
    noseWidth,
    noseWidthToFaceRatio,
    noseLengthToFaceRatio,
    noseProminence,
    noseProminenceProfile,
    mouthWidthToNoseRatio,
    mouthWidthToFaceRatio,
    widthToHeightRatio,
    foreheadToCheekRatio,
    jawToCheekRatio,
    jawAngleSharpness,
    foreheadWidthRatio: cheekBandWidth ? (foreheadBandWidth ?? 0) / cheekBandWidth : null,
    chinWidthRatio: cheekBandWidth ? (jawBandWidth ?? 0) / cheekBandWidth : null,
    cheekBalance,
  };
}

/**
 * @param {Record<string, {landmarks: any[]}>} capturedPoses - key: front|left|right|up|down
 * @param {object} groups - faceEngine.landmarkGroups
 */
export function computeMeasurements(capturedPoses, groups) {
  const perPose = {};
  for (const [key, pose] of Object.entries(capturedPoses)) {
    if (pose?.landmarks) {
      perPose[key] = computeSinglePoseMetrics(pose.landmarks, groups, pose.pose);
    }
  }

  const succeeded = Object.entries(perPose).filter(([, v]) => v);
  if (succeeded.length === 0) {
    throw new Error('얼굴 랜드마크를 계산할 수 없습니다.');
  }

  // 삼정 비율과 코 돌출도는 여러 각도(front/left/right/up/down)에서 각각 독립적으로 계산한 뒤
  // 평균을 내어 단일 사진의 각도·조명에 따른 오차를 줄인다.
  const samjeongRatios = {
    upper: average(succeeded.map(([, v]) => v.samjeongRatios.upper)),
    middle: average(succeeded.map(([, v]) => v.samjeongRatios.middle)),
    lower: average(succeeded.map(([, v]) => v.samjeongRatios.lower)),
  };
  const sumRatio = samjeongRatios.upper + samjeongRatios.middle + samjeongRatios.lower;
  samjeongRatios.upper /= sumRatio;
  samjeongRatios.middle /= sumRatio;
  samjeongRatios.lower /= sumRatio;

  // 코 돌출도: 좌우 회전(turnA/turnB) 옆모습에서 계산한 값이 있으면 그쪽을 우선 사용한다.
  // 정면 사진의 z(깊이) 추정은 MediaPipe 특성상 오차가 커서, 실제로는 코가 낮아도 "매우
  // 높음"으로 나오는 경우가 있었다 — 옆모습 기반 값은 순수 2D 기하로 계산해 이 문제가 없다.
  // 옆모습이 없는 경우(촬영 실패 등)에는 기존처럼 정면 기준 값으로 대체한다.
  const profileSamples = succeeded
    .map(([, v]) => v.noseProminenceProfile)
    .filter((v) => v != null);
  const noseProminence = profileSamples.length
    ? average(profileSamples)
    : average(succeeded.map(([, v]) => v.noseProminence));

  // 나머지 지표는 정면(front)이 없으면 사용 가능한 첫 포즈를 사용
  const primary = perPose.front ?? succeeded[0][1];

  return {
    coverage: {
      capturedPoses: Object.keys(perPose),
      totalRequested: Object.keys(capturedPoses).length,
      samples: succeeded.length,
    },
    faceWidth: primary.faceWidth,
    faceHeight: primary.faceHeight,
    // 인포그래픽은 정면 사진 위에 그리므로, 정면 포즈에서 계산된 좌표만 사용한다(다른 각도로 대체 불가).
    anchors: perPose.front?.anchors ?? null,
    measurementLines: perPose.front?.measurementLines ?? null,
    samjeongRatios,
    eyebrowLengthToEyeRatio: primary.eyebrowLengthToEyeRatio,
    browThicknessRatio: primary.browThicknessRatio,
    browArchHeight: primary.browArchHeight,
    eyeApertureRatio: primary.eyeApertureRatio,
    eyeWidthToFaceRatio: primary.eyeWidthToFaceRatio,
    eyeSpacingRatio: primary.eyeSpacingRatio,
    noseWidthToFaceRatio: primary.noseWidthToFaceRatio,
    noseLengthToFaceRatio: primary.noseLengthToFaceRatio,
    noseProminence,
    mouthWidthToNoseRatio: primary.mouthWidthToNoseRatio,
    mouthWidthToFaceRatio: primary.mouthWidthToFaceRatio,
    widthToHeightRatio: primary.widthToHeightRatio,
    foreheadToCheekRatio: primary.foreheadToCheekRatio,
    jawToCheekRatio: primary.jawToCheekRatio,
    jawAngleSharpness: primary.jawAngleSharpness,
    foreheadWidthRatio: primary.foreheadWidthRatio,
    chinWidthRatio: primary.chinWidthRatio,
    cheekBalance: primary.cheekBalance,
  };
}
