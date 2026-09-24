/**
 * Reading the called number aloud, made reliable.
 *
 * The Web Speech API is full of traps that make it work on your machine and silently
 * do nothing on someone else's:
 *
 *  - Chrome drops an utterance if you `cancel()` and `speak()` in the same tick.
 *  - Chrome and Safari block speech entirely until the page has seen a real user
 *    gesture, and a listener waiting for someone else to call a number hasn't made one.
 *  - Chrome populates `getVoices()` asynchronously; speaking before they arrive can
 *    quietly no-op.
 *  - A backgrounded tab can leave the engine paused, after which everything queues
 *    forever and then blurts out at once when you come back.
 *
 * Everything below exists to dodge one of those.
 */

const synth: SpeechSynthesis | undefined =
  typeof window !== 'undefined' && 'speechSynthesis' in window
    ? window.speechSynthesis
    : undefined;

let primed = false;
let blocked = false;
let onBlockedChange: ((blocked: boolean) => void) | null = null;

/** Let the UI show that the browser is refusing to read numbers out. */
export function watchSpeechBlocked(cb: (blocked: boolean) => void) {
  onBlockedChange = cb;
}

function setBlocked(v: boolean) {
  if (blocked === v) return;
  blocked = v;
  onBlockedChange?.(v);
}

export function speechSupported(): boolean {
  return !!synth;
}

/**
 * Call this from a real user gesture — any click will do. It loads the voice list and
 * spends the gesture on a silent utterance, which is what buys us permission to speak
 * later, when the number arrives over the socket with no gesture of our own.
 */
export function primeSpeech() {
  if (!synth || primed) return;
  primed = true;

  synth.getVoices();
  synth.addEventListener?.('voiceschanged', () => synth.getVoices(), { once: true });

  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  } catch {
    // If even the silent primer throws, the real one will report it properly.
  }

  primeChime();
}

function utter(text: string) {
  if (!synth) return;
  // A tab that was backgrounded mid-utterance can come back paused, and everything
  // after that just queues.
  if (synth.paused) synth.resume();

  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.9;
  u.pitch = 1.05;
  u.volume = 1;
  u.onstart = () => setBlocked(false);
  u.onerror = (e) => {
    // 'interrupted' and 'canceled' are us cancelling on purpose, not a failure.
    const reason = (e as SpeechSynthesisErrorEvent).error;
    if (reason !== 'interrupted' && reason !== 'canceled') setBlocked(true);
  };

  try {
    synth.speak(u);
  } catch {
    setBlocked(true);
  }
}

/**
 * Say a called number out loud, as reliably as the platform allows.
 *
 * Deliberately still speaks when the tab is in the background — that is precisely when
 * a player needs to be told a number was called. There's no risk of a queue building up
 * and blurting later, because each call cancels the one before it.
 */
export function speak(text: string) {
  if (!synth) return;

  if (synth.speaking || synth.pending) {
    // Never cancel and speak in the same tick — Chrome loses the new utterance.
    synth.cancel();
    setTimeout(() => utter(text), 120);
  } else {
    utter(text);
  }
}

/* ------------------------------------------------------------------- the chime */

let audio: AudioContext | null = null;

function primeChime() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

/**
 * A short two-note cue, played alongside the spoken number. Speech can be blocked,
 * throttled or simply unavailable; a tone is about as reliable as browser audio gets,
 * so at minimum a player always hears *that* a number was called — including when they
 * are looking at another tab, which is when they most need telling.
 */
export function chime() {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') void audio.resume();
    const t0 = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const at = t0 + i * 0.1;
      // A quick swell and decay: a raw square edge clicks unpleasantly.
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(at);
      osc.stop(at + 0.2);
    }
  } catch {
    // Audio is a nicety; never let it break the round.
  }
}
