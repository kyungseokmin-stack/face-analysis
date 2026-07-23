// main.js — 화면 전환과 카메라/분석 파이프라인을 연결하는 진입점.
// 어떤 얼굴 이미지·영상·랜드마크 데이터도 네트워크로 전송하지 않는다. (콘솔에서 Network 탭으로 직접 확인 가능)

import { FaceEngine } from './faceEngine.js';
import { HairEngine } from './hairEngine.js';
import { CaptureFlow } from './captureFlow.js';
import { computeMeasurements, estimateCenterXRatio } from './measurements.js';
import { buildReport } from './reportEngine.js';
import { buildInfographic, downloadCanvas } from './infographic.js';
import { initAudio, playStepDing, playAllDone } from './sound.js';
import { cropEarBand } from './earCrop.js';

const screens = {
  intro: document.getElementById('screen-intro'),
  consent: document.getElementById('screen-consent'),
  capture: document.getElementById('screen-capture'),
  analyzing: document.getElementById('screen-analyzing'),
  report: document.getElementById('screen-report'),
  error: document.getElementById('screen-error'),
};

function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    if (!el) continue;
    el.hidden = key !== name;
  }
  window.scrollTo({ top: 0 });
}

let mediaStream = null;
let faceEngine = null;
let hairEngine = null;
let captureFlow = null;

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    img.src = dataUrl;
  });
}

// .app-header는 제목+부제목이 뷰포트 폭에 따라 줄바꿈 방식이 달라져 실제 렌더 높이가
// ~93~110px 사이로 유동적이다. #report-nav가 스티키로 고정될 때 이 헤더 아래(그리고
// 헤더보다 낮은 z-index) 정확히 붙어야 하므로, CSS에 고정값을 하드코딩하는 대신 여기서
// 실측해 --header-h 커스텀 프로퍼티로 넘긴다. 초기 로드와 리사이즈(부제목 줄바꿈이
// 바뀔 수 있으므로) 시점에 다시 측정한다.
function syncHeaderHeightVar() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
}

let headerHeightResizeTimer = null;
function scheduleHeaderHeightSync() {
  if (headerHeightResizeTimer) clearTimeout(headerHeightResizeTimer);
  headerHeightResizeTimer = setTimeout(syncHeaderHeightVar, 150);
}

syncHeaderHeightVar();
window.addEventListener('resize', scheduleHeaderHeightSync);

function stopCamera() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
  captureFlow?.stop();
  // 보류 중인 "3초간 얼굴 미인식" 타이머를 정리하지 않으면, 사용자가 촬영을 중단한 뒤
  // 곧바로 새 세션을 시작했을 때 이 타이머가 새 세션 도중 뒤늦게 발화해 얼굴이 정상
  // 인식되고 있는데도 no-face-hint를 잘못 띄울 수 있다.
  if (noFaceTimer) {
    clearTimeout(noFaceTimer);
    noFaceTimer = null;
  }
}

function showError(message, detail) {
  stopCamera();
  document.getElementById('error-message').textContent = message;
  document.getElementById('error-detail').textContent = detail || '';
  showScreen('error');
}

// --- intro ---
document.getElementById('btn-start').addEventListener('click', () => {
  showScreen('consent');
});

document.getElementById('link-privacy-intro').addEventListener('click', (e) => {
  e.preventDefault();
  window.open('privacy.html', '_blank', 'noopener');
});

// --- consent ---
const consentCheckbox = document.getElementById('consent-checkbox');
const btnConsentContinue = document.getElementById('btn-consent-continue');
consentCheckbox.addEventListener('change', () => {
  btnConsentContinue.disabled = !consentCheckbox.checked;
});

btnConsentContinue.addEventListener('click', async () => {
  initAudio(); // 사용자 제스처 안에서 호출해야 이후 알림음 재생이 허용된다
  showScreen('capture');
  await beginCaptureSession();
});

document.getElementById('link-privacy-consent').addEventListener('click', (e) => {
  e.preventDefault();
  window.open('privacy.html', '_blank', 'noopener');
});

// --- capture screen elements ---
const videoEl = document.getElementById('camera-video');
const stepInstructionEl = document.getElementById('step-instruction');
const stepSubEl = document.getElementById('step-sub');
const holdRingEl = document.getElementById('hold-ring');
const noFaceHintEl = document.getElementById('no-face-hint');
const closeUpHintEl = document.getElementById('close-up-hint');
const stepDotsEl = document.getElementById('step-dots');
const btnAbortCapture = document.getElementById('btn-abort-capture');
const captureStageEl = document.querySelector('.capture-stage');
const filmstripEl = document.getElementById('capture-filmstrip');
const angleProgressEl = document.getElementById('angle-progress');
const angleProgressFillEl = document.getElementById('angle-progress-fill');

btnAbortCapture.addEventListener('click', () => {
  stopCamera();
  showScreen('intro');
});

function syncCaptureStageAspectRatio() {
  if (captureStageEl && videoEl.videoWidth && videoEl.videoHeight) {
    captureStageEl.style.aspectRatio = `${videoEl.videoWidth} / ${videoEl.videoHeight}`;
  }
}

function renderStepDots(activeIndex, total) {
  stepDotsEl.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const dot = document.createElement('span');
    dot.className = 'step-dot' + (i < activeIndex ? ' done' : i === activeIndex ? ' active' : '');
    stepDotsEl.appendChild(dot);
  }
}

// 촬영 화면 아래 필름스트립 — "이 단계를 실제로 찍었는지" 헷갈린다는 피드백을 받아, 추상적인
// 점 대신 각 단계에서 실제로 캡처된 프레임 썸네일과 방향 라벨(왼쪽/오른쪽/위/아래)을 그대로
// 보여준다. 방향은 캡처 전에는 알 수 없으므로(사람마다 처음 도는 방향이 다름) 기본 아이콘/라벨로
// 시작했다가, captureFlow가 실제 방향을 감지한 시점(onStepCaptured)에 갱신한다.
const STEP_ICON = { front: '🙂', turnA: '↔️', turnB: '↔️', tiltA: '↕️', tiltB: '↕️' };
const STEP_DEFAULT_LABEL = { front: '정면', turnA: '좌우 회전', turnB: '좌우 회전', tiltA: '상하 기울임', tiltB: '상하 기울임' };

function renderFilmstripPlaceholders(steps) {
  filmstripEl.innerHTML = '';
  steps.forEach((step, i) => {
    const slot = document.createElement('div');
    slot.className = 'filmstrip-slot' + (i === 0 ? ' active' : '');
    slot.id = `filmstrip-slot-${step.key}`;
    slot.innerHTML = `
      <div class="filmstrip-media"><span class="filmstrip-icon">${STEP_ICON[step.key] ?? '•'}</span></div>
      <span class="filmstrip-label">${STEP_DEFAULT_LABEL[step.key] ?? step.key}</span>
    `;
    filmstripEl.appendChild(slot);
  });
}

function setFilmstripActive(activeIndex, steps) {
  steps.forEach((step, i) => {
    const slot = document.getElementById(`filmstrip-slot-${step.key}`);
    if (!slot) return;
    slot.classList.toggle('active', i === activeIndex);
  });
}

function updateFilmstripSlot(stepKey, { photoDataUrl, screenSide, screenDir }) {
  const slot = document.getElementById(`filmstrip-slot-${stepKey}`);
  if (!slot) return;
  slot.classList.add('done');
  slot.classList.remove('active');

  let label = STEP_DEFAULT_LABEL[stepKey] ?? stepKey;
  if (screenSide) label = screenSide === 'left' ? '왼쪽 회전' : '오른쪽 회전';
  if (screenDir) label = screenDir === 'up' ? '위 기울임' : '아래 기울임';

  slot.innerHTML = `
    <div class="filmstrip-media">
      <img src="${photoDataUrl}" alt="${label} 촬영 사진" class="filmstrip-thumb" />
      <span class="filmstrip-check" aria-hidden="true">✓</span>
    </div>
    <span class="filmstrip-label">${label}</span>
  `;
}

let noFaceTimer = null;

async function beginCaptureSession() {
  try {
    if (!window.isSecureContext) {
      showError('안전한 연결(HTTPS)이 아닙니다.', '카메라 접근은 보안 연결에서만 허용됩니다. https 주소로 다시 접속해주세요.');
      return;
    }

    mediaStream = await navigator.mediaDevices.getUserMedia({
      // 해상도를 높여 얼굴 랜드마크가 더 세밀하게(클로즈업하듯) 잡히도록 한다.
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = mediaStream;
    await videoEl.play();
    // 미리보기 컨테이너는 3:4로 고정돼 있지만, 실제 카메라가 내려주는 해상도의 가로세로
    // 비율은 기기마다 다르다(보통 4:3 등 가로형). 두 비율이 다르면 object-fit:cover가
    // 미리보기 좌우를 크게 잘라내 화면상 "줌"이 걸린 것처럼 보이는데, 이때 사용자는 잘려
    // 보이지 않는 미리보기 기준으로 고개를 돌리게 되어 실제로는 필요 이상으로 많이 회전하게
    // 되고, 그 결과 랜드마크 인식이 끊기거나 귀 촬영 타이밍을 놓치는 문제로 이어진다. 컨테이너의
    // aspect-ratio를 실제 영상 스트림의 비율에 맞춰 덮어써서, 미리보기가 항상 캡처되는 원본
    // 프레임 그대로(잘림 없이)를 보여주도록 한다.
    syncCaptureStageAspectRatio();
    videoEl.addEventListener('loadedmetadata', syncCaptureStageAspectRatio);

    if (!faceEngine) {
      faceEngine = new FaceEngine();
      stepInstructionEl.textContent = '얼굴 인식 모델을 불러오는 중...';
      stepSubEl.textContent = '';
      await faceEngine.init((msg) => {
        stepInstructionEl.textContent = msg;
      });
    }

    captureFlow = new CaptureFlow(faceEngine, videoEl, {
      onFrame: ({ stepIndex, step, pose, holdRatio, faceDetected, faceSizeRatio, ctx }) => {
        stepInstructionEl.textContent = step.instruction;
        stepSubEl.textContent = step.sub;
        renderStepDots(stepIndex, captureFlow.steps.length);
        setFilmstripActive(stepIndex, captureFlow.steps);
        holdRingEl.style.setProperty('--progress', String(holdRatio));

        // 목표 각도(회전/기울임)까지 얼마나 왔는지 실시간으로 보여준다. front 단계는 "중앙에
        // 머무르기"라 이 막대와 성격이 다르므로 숨긴다. turnB/tiltB는 반대 부호로 넘어가야
        // 목표가 인정되므로, 아직 첫 단계와 같은 방향으로 돌고 있다면(부호가 안 바뀌었다면)
        // 아무리 각도가 커도 진행률을 0으로 유지해 "그 방향이 아니라 반대로 더 돌아야 한다"는
        // 사실을 잘못 전달하지 않도록 한다.
        if (step.axis && pose) {
          const value = step.axis === 'yaw' ? pose.yaw : pose.pitch;
          const referenceSign = step.axis === 'yaw' ? ctx?.turnASign : ctx?.tiltASign;
          const wrongDirection = referenceSign != null && Math.sign(value) === Math.sign(referenceSign);
          const angleRatio = wrongDirection ? 0 : Math.min(1, Math.abs(value) / step.threshold);
          angleProgressEl.hidden = false;
          angleProgressFillEl.style.width = `${angleRatio * 100}%`;
          angleProgressFillEl.classList.toggle('reached', angleRatio >= 1);
        } else {
          angleProgressEl.hidden = true;
        }

        if (!faceDetected) {
          if (!noFaceTimer) {
            noFaceTimer = setTimeout(() => {
              noFaceHintEl.hidden = false;
            }, 3000);
          }
          closeUpHintEl.hidden = true;
        } else {
          noFaceHintEl.hidden = true;
          if (noFaceTimer) {
            clearTimeout(noFaceTimer);
            noFaceTimer = null;
          }
          // 얼굴이 화면에서 너무 작으면(멀리서 촬영 중이면) 랜드마크 정밀도가 떨어지므로
          // 좀 더 가까이 와서 클로즈업으로 촬영하도록 안내한다. 다만 이 안내는 정면(front)
          // 단계의 측정 정밀도를 위한 것으로, 좌우 회전(turnA/turnB) 단계에도 그대로 적용하면
          // 카메라와 너무 가까운 상태에서 고개를 돌리게 되어 웹캠의 좁은 화각 때문에 귀가
          // 프레임 밖으로 밀려나 버린다. 따라서 정면 단계에서만 노출한다.
          closeUpHintEl.hidden = step.key !== 'front' || faceSizeRatio == null || faceSizeRatio >= 0.32;
        }
      },
      onStepCaptured: (stepKey, stepIndex, info) => {
        holdRingEl.style.setProperty('--progress', '0');
        updateFilmstripSlot(stepKey, info);
        const isLastStep = stepIndex >= captureFlow.steps.length - 1;
        if (isLastStep) playAllDone();
        else playStepDing();
      },
      onComplete: async (capturedPoses) => {
        stopCamera();
        showScreen('analyzing');
        await runAnalysis(capturedPoses);
      },
    });
    renderFilmstripPlaceholders(captureFlow.steps);
    captureFlow.start();
  } catch (err) {
    console.error(err);
    if (err && err.name === 'NotAllowedError') {
      showError(
        '카메라 권한이 거부되었습니다.',
        '브라우저 설정에서 이 사이트의 카메라 권한을 허용한 뒤 다시 시도해주세요. 촬영된 영상은 기기 밖으로 전송되지 않습니다.'
      );
    } else if (err && err.name === 'NotFoundError') {
      showError('카메라를 찾을 수 없습니다.', '카메라가 있는 기기와 브라우저에서 다시 시도해주세요.');
    } else {
      showError('얼굴 인식 모델을 불러오지 못했습니다.', '네트워크 연결을 확인한 뒤 다시 시도해주세요. (' + (err?.message || err) + ')');
    }
  }
}

// --- analysis ---
let currentInfographicCanvas = null;

async function runAnalysis(capturedPoses) {
  try {
    await new Promise((resolve) => setTimeout(resolve, 300)); // 짧은 전환 여유
    const groups = faceEngine.landmarkGroups;

    // 헤어라인(이마 시작선) 검출 — 정면 캡처 사진 한 장에만 1회 실행한다("우리는 이마의
    // 넓고 좁음을 판단하는 기준이 이상하다"는 지적: 얼굴 윤곽 랜드마크는 머리카락을
    // 추적하지 않아 헤어라인보다 한참 아래에서 끊긴다). 모델 로드·추론에 실패해도(구형
    // 브라우저, 네트워크 문제 등) 전체 분석이 멈추지 않도록 실패를 여기서 흡수하고,
    // hairlineY는 null로 두어 measurements.js가 기존 방식(윤곽 최상단)으로 되돌아가게 한다.
    let hairlineY = null;
    let hairlineError = null;
    let hairlineDebug = null;
    if (capturedPoses.front?.photoDataUrl && capturedPoses.front?.landmarks) {
      try {
        const centerXRatio = estimateCenterXRatio(capturedPoses.front.landmarks, groups);
        if (centerXRatio != null) {
          hairEngine = hairEngine ?? new HairEngine();
          await hairEngine.init();
          const frontImg = await loadImage(capturedPoses.front.photoDataUrl);
          const result = hairEngine.detectHairlineY(frontImg, centerXRatio);
          hairlineY = result.hairlineY;
          hairlineDebug = result.debug;
        }
      } catch (err) {
        console.error('hairline detection failed', err);
        hairlineError = err?.message || String(err);
      }
    }

    const measurements = computeMeasurements(capturedPoses, groups, hairlineY);
    const report = buildReport(measurements);

    // 모바일에서는 개발자도구를 열기 번거로우므로, 헤어라인 검출이 실패한 원인(예외든,
    // 예외 없이 그냥 못 찾은 경우든)을 리포트 화면에서 바로 확인할 수 있도록 삼정 섹션
    // 설명에 덧붙인다. 이건 어디까지나 임시 디버그용 표시다.
    if (hairlineError) {
      const samjeongSection = report.sections.find((s) => s.id === 'samjeong');
      if (samjeongSection) {
        samjeongSection.description += ` [디버그: 헤어라인 검출 중 오류 발생 — ${hairlineError}]`;
      }
    } else if (hairlineDebug) {
      const samjeongSection = report.sections.find((s) => s.id === 'samjeong');
      if (samjeongSection) {
        samjeongSection.description += ` [디버그: ${hairlineDebug}]`;
      }
    }

    const earPhotos = [];
    for (const key of ['turnA', 'turnB']) {
      const pose = capturedPoses[key];
      if (!pose?.photoDataUrl) continue;
      try {
        const cropped = await cropEarBand(pose.photoDataUrl, pose.landmarks, groups);
        if (cropped) earPhotos.push(cropped);
      } catch (err) {
        console.error('ear crop failed', err);
      }
    }

    renderReport(report, earPhotos);

    let infographicCanvas = null;
    if (capturedPoses.front?.photoDataUrl && measurements.anchors) {
      try {
        infographicCanvas = await buildInfographic({
          photoDataUrl: capturedPoses.front.photoDataUrl,
          landmarks: capturedPoses.front.landmarks,
          groups,
          anchors: measurements.anchors,
          measurementLines: measurements.measurementLines,
          measurements,
          report,
        });
      } catch (err) {
        console.error('infographic build failed', err);
      }
    }
    renderInfographic(infographicCanvas);

    showScreen('report');
  } catch (err) {
    console.error(err);
    showError('분석 중 문제가 발생했습니다.', '조명이 밝은 곳에서 다시 촬영해보세요. (' + (err?.message || err) + ')');
  }
}

function renderInfographic(canvas) {
  const section = document.getElementById('infographic-section');
  const wrap = document.getElementById('infographic-preview-wrap');
  wrap.innerHTML = '';
  currentInfographicCanvas = canvas;
  if (!canvas) {
    section.hidden = true;
    return;
  }
  canvas.className = 'infographic-canvas';
  wrap.appendChild(canvas);
  section.hidden = false;
}

document.getElementById('btn-download-infographic').addEventListener('click', () => {
  if (currentInfographicCanvas) downloadCanvas(currentInfographicCanvas);
});

// --- report rendering ---
function renderKeyMetrics(keyMetrics) {
  const dashboard = document.getElementById('metrics-dashboard');
  const grid = document.getElementById('metrics-grid');
  if (!keyMetrics || !keyMetrics.length) {
    dashboard.hidden = true;
    return;
  }
  grid.innerHTML = '';
  for (const metric of keyMetrics) {
    const tile = document.createElement('div');
    tile.className = 'metric-gauge';

    const label = document.createElement('p');
    label.className = 'metric-gauge-label';
    label.textContent = metric.label;
    tile.appendChild(label);

    const bar = document.createElement('div');
    bar.className = 'metric-gauge-bar';
    for (let i = 0; i < 5; i++) {
      const seg = document.createElement('span');
      seg.className = 'metric-gauge-seg' + (i === metric.tierIndex ? ' on' : '');
      bar.appendChild(seg);
    }
    tile.appendChild(bar);

    const caption = document.createElement('p');
    caption.className = 'metric-gauge-caption';
    caption.textContent = metric.caption;
    tile.appendChild(caption);

    grid.appendChild(tile);
  }
  dashboard.hidden = false;
}

function renderReportNav(sections) {
  const nav = document.getElementById('report-nav');
  nav.innerHTML = '';
  for (const section of sections) {
    const a = document.createElement('a');
    a.href = `#section-${section.id}`;
    a.textContent = section.title;
    nav.appendChild(a);
  }
}

function renderReport(report, earPhotos = []) {
  // 리포트 화면으로 전환되는 시점에 헤더 높이를 다시 한번 확인한다 — 폰트 로딩 등으로
  // 최초 측정 이후 헤더 높이가 미세하게 바뀌었을 수 있어, 스티키 nav가 가려지는 것을 막는다.
  syncHeaderHeightVar();
  const container = document.getElementById('report-sections');
  container.innerHTML = '';

  const coverageEl = document.getElementById('report-coverage');
  coverageEl.textContent = `${report.coverage.samples} / ${report.coverage.totalRequested}단계 촬영 반영 · 여러 각도 데이터를 교차 평균하여 오차를 줄였습니다.`;

  renderKeyMetrics(report.keyMetrics);
  renderReportNav(report.sections);

  for (const section of report.sections) {
    const card = document.createElement('article');
    card.id = `section-${section.id}`;
    card.className = 'report-card' + (section.qualitative ? ' qualitative' : '');

    const header = document.createElement('div');
    header.className = 'report-card-header';
    const h3 = document.createElement('h3');
    h3.textContent = section.title;
    header.appendChild(h3);
    if (section.source) {
      const badge = document.createElement('span');
      badge.className = 'source-badge';
      badge.textContent = section.source.short;
      badge.title = section.source.note;
      header.appendChild(badge);
    }
    card.appendChild(header);

    if (section.description) {
      const desc = document.createElement('p');
      desc.className = 'report-desc';
      desc.textContent = section.description;
      card.appendChild(desc);
    }

    if (section.ratios) {
      const bar = document.createElement('div');
      bar.className = 'samjeong-bar';
      for (const key of ['upper', 'middle', 'lower']) {
        const seg = document.createElement('div');
        seg.className = `samjeong-seg samjeong-${key}`;
        seg.style.flexGrow = String(section.ratios[key]);
        seg.title = section.regions[key].label;
        bar.appendChild(seg);
      }
      card.appendChild(bar);
    }

    const ul = document.createElement('ul');
    ul.className = 'report-text-list';
    for (const line of section.text) {
      const li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    }
    card.appendChild(ul);

    if (section.showEarPhotos && earPhotos.length) {
      const photoRow = document.createElement('div');
      photoRow.className = 'ear-photo-row';
      earPhotos.forEach((canvas, i) => {
        const fig = document.createElement('figure');
        fig.className = 'ear-photo-fig';
        canvas.className = 'ear-photo-canvas';
        const cap = document.createElement('figcaption');
        cap.textContent = `측면 촬영 ${i + 1}`;
        fig.appendChild(canvas);
        fig.appendChild(cap);
        photoRow.appendChild(fig);
      });
      card.appendChild(photoRow);
    } else if (section.showEarPhotos) {
      const p = document.createElement('p');
      p.className = 'report-desc';
      p.textContent = '측면 사진을 확보하지 못했습니다. 다시 촬영하면 좌우 회전 단계에서 사진이 저장됩니다.';
      card.appendChild(p);
    }

    if (section.checklist) {
      const clWrap = document.createElement('div');
      clWrap.className = 'ear-checklist';
      for (const item of section.checklist) {
        const row = document.createElement('div');
        row.className = 'ear-checklist-item';
        const strong = document.createElement('strong');
        strong.textContent = item.label;
        row.appendChild(strong);
        row.appendChild(document.createTextNode(' ' + item.desc));
        clWrap.appendChild(row);
      }
      card.appendChild(clWrap);
    }

    container.appendChild(card);
  }

  const disclaimerEl = document.getElementById('report-disclaimer');
  disclaimerEl.innerHTML = '';
  for (const line of report.disclaimer) {
    const p = document.createElement('p');
    p.textContent = line;
    disclaimerEl.appendChild(p);
  }
}

document.getElementById('btn-restart').addEventListener('click', () => {
  renderInfographic(null); // 이전 촬영의 사진/인포그래픽을 메모리에서 즉시 폐기
  showScreen('intro');
});

document.getElementById('link-privacy-report').addEventListener('click', (e) => {
  e.preventDefault();
  window.open('privacy.html', '_blank', 'noopener');
});

document.getElementById('btn-error-restart').addEventListener('click', () => {
  showScreen('intro');
});

window.addEventListener('beforeunload', stopCamera);

showScreen('intro');
