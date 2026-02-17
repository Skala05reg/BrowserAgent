export interface BackoffOptions {
  baseDelayMs: number;
  attempt: number;
  multiplier: number;
  maxDelayMs: number;
  jitterRatio: number;
  random?: () => number;
}

export function computeBoundedBackoffDelayMs(options: BackoffOptions): number {
  const baseDelayMs = Math.max(0, Math.round(options.baseDelayMs));
  const maxDelayMs = Math.max(0, Math.round(options.maxDelayMs));
  if (baseDelayMs <= 0 || maxDelayMs <= 0) {
    return 0;
  }

  const exponent = Math.max(0, Math.round(options.attempt) - 1);
  const multiplier = Math.max(1, options.multiplier);
  const scaled = baseDelayMs * Math.pow(multiplier, exponent);
  const jittered = applySymmetricJitter(scaled, options.jitterRatio, options.random);

  return Math.min(maxDelayMs, Math.max(0, Math.round(jittered)));
}

export function applySymmetricJitter(
  value: number,
  ratio: number,
  random: () => number = Math.random
): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const safeRatio = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  if (safeRatio <= 0) {
    return value;
  }

  const amplitude = value * safeRatio;
  const min = value - amplitude;
  const max = value + amplitude;
  const sampled = random();
  const normalizedRandom = Number.isFinite(sampled) ? sampled : 0.5;
  const clampedRandom = Math.min(1, Math.max(0, normalizedRandom));
  return min + (max - min) * clampedRandom;
}
