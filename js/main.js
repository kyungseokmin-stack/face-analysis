// main.js — 화면 전환과 카메라/분석 파이프라인을 연결하는 진입점.
// 어떤 얼굴 이미지·영상·랜드마크 데이터도 네트워크로 전송하지 않는다. (콘솔에서 Network 탭으로 직접 확인 가능)

import { FaceEngine } from './faceEngine.js';
import { CaptureFlow } from './captureFlow.js';
import { computeMeasurements } from './measurements.js';
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
let captureFlow = null;

function stopCamera() {
  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
    mediaStream = null;
  }
  captureFlow?.stop();
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
      onFrame: ({ stepIndex, step, pose, holdRatio, faceDetected, faceSizeRatio }) => {
        stepInstructionEl.textContent = step.instruction;
        stepSubEl.textContent = step.sub;
        renderStepDots(stepIndex, captureFlow.steps.length);
        holdRingEl.style.setProperty('--progress', String(holdRatio));

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
      onStepCaptured: (stepKey, stepIndex) => {
        holdRingEl.style.setProperty('--progress', '0');
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
    const measurements = computeMeasurements(capturedPoses, groups);
    const report = buildReport(measurements);

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
function renderReport(report, earPhotos = []) {
  const container = document.getElementById('report-sections');
  container.innerHTML = '';

  const coverageEl = document.getElementById('report-coverage');
  coverageEl.textContent = `${report.coverage.samples} / ${report.coverage.totalRequested}단계 촬영 반영 · 여러 각도 데이터를 교차 평균하여 오차를 줄였습니다.`;

  for (const section of report.sections) {
    const card = document.createElement('article');
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
