export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const G0 = 9.81;

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const saturate = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Frame-rate independent exponential smoothing: moves `a` toward `b` with rate `lambda` (1/s). */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  a + (b - a) * (1 - Math.exp(-lambda * dt));

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function moveToward(a: number, b: number, maxDelta: number): number {
  return Math.abs(b - a) <= maxDelta ? b : a + Math.sign(b - a) * maxDelta;
}

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Small, fast, seedable PRNG (deterministic world generation depends on this). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _chan = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const _waiters: (() => void)[] = [];
if (_chan) {
  _chan.port1.onmessage = () => _waiters.shift()?.();
}

/**
 * Let the browser paint / handle input between chunks of work. Uses a MessageChannel instead of
 * setTimeout(0) because timers are throttled to ~1 Hz in background tabs, which would make loading crawl.
 */
export function yieldToMain(): Promise<void> {
  if (!_chan) return new Promise((r) => setTimeout(r, 0));
  return new Promise((r) => {
    _waiters.push(r);
    _chan.port2.postMessage(0);
  });
}
