import { describe, expect, it } from "vitest";
import { applySymmetricJitter, computeBoundedBackoffDelayMs } from "../../src/core/backoff.js";

describe("computeBoundedBackoffDelayMs", () => {
  it("computes exponential backoff without jitter", () => {
    const first = computeBoundedBackoffDelayMs({
      baseDelayMs: 100,
      attempt: 1,
      multiplier: 2,
      maxDelayMs: 10_000,
      jitterRatio: 0
    });
    const third = computeBoundedBackoffDelayMs({
      baseDelayMs: 100,
      attempt: 3,
      multiplier: 2,
      maxDelayMs: 10_000,
      jitterRatio: 0
    });

    expect(first).toBe(100);
    expect(third).toBe(400);
  });

  it("applies max bound after jitter", () => {
    const bounded = computeBoundedBackoffDelayMs({
      baseDelayMs: 100,
      attempt: 5,
      multiplier: 2,
      maxDelayMs: 300,
      jitterRatio: 0.5,
      random: () => 1
    });

    expect(bounded).toBe(300);
  });

  it("returns zero for non-positive base or max", () => {
    expect(
      computeBoundedBackoffDelayMs({
        baseDelayMs: 0,
        attempt: 2,
        multiplier: 2,
        maxDelayMs: 1000,
        jitterRatio: 0
      })
    ).toBe(0);
    expect(
      computeBoundedBackoffDelayMs({
        baseDelayMs: 100,
        attempt: 2,
        multiplier: 2,
        maxDelayMs: 0,
        jitterRatio: 0
      })
    ).toBe(0);
  });
});

describe("applySymmetricJitter", () => {
  it("keeps value when jitter is disabled", () => {
    expect(applySymmetricJitter(200, 0)).toBe(200);
  });

  it("applies deterministic jitter from injected random", () => {
    const low = applySymmetricJitter(100, 0.2, () => 0);
    const high = applySymmetricJitter(100, 0.2, () => 1);

    expect(low).toBe(80);
    expect(high).toBe(120);
  });
});
