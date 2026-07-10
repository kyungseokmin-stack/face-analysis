// sound.js
//
// 촬영 중 화면 문구를 계속 눈으로 읽지 않아도 다음 동작을 알 수 있도록, 각 단계가
// 끝날 때 짧은 알림음을 재생한다. 오디오 파일을 쓰지 않고 Web Audio API로 즉석에서
// 생성하므로 네트워크 요청이 없다.

let audioCtx = null;

/** 반드시 사용자 제스처(클릭 등) 안에서 호출해야 iOS Safari 등에서 재생이 허용된다. */
export function initAudio() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  audioCtx = new Ctx();
}

function playTone(freq, startTime, duration, peakGain = 0.22) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function ensureReady() {
  if (!audioCtx) return false;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return true;
}

/** 한 단계(각도) 촬영이 끝났을 때 재생하는 짧은 "띵동" */
export function playStepDing() {
  if (!ensureReady()) return;
  const now = audioCtx.currentTime;
  playTone(1318.5, now, 0.14); // E6
  playTone(1760, now + 0.1, 0.18); // A6
}

/** 5단계 촬영이 모두 끝났을 때 재생하는 완료음 */
export function playAllDone() {
  if (!ensureReady()) return;
  const now = audioCtx.currentTime;
  playTone(1046.5, now, 0.12); // C6
  playTone(1318.5, now + 0.09, 0.12); // E6
  playTone(1568, now + 0.18, 0.24); // G6
}
