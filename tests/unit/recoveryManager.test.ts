import { describe, expect, it } from "vitest";
import { RecoveryManager } from "../../src/core/recoveryManager.js";

describe("RecoveryManager", () => {
  it("creates retry plan for transient errors", () => {
    const manager = new RecoveryManager({
      enabled: true,
      retrySameActionOnTransientErrors: true,
      transientErrorKeywords: ["timeout"],
      popupDismissKey: "Escape",
      waitMsAfterFailure: 100,
      maxWaitMsAfterFailure: 1000,
      backoffMultiplier: 1.5,
      jitterRatio: 0,
      scrollRecoveryAmount: 300,
      maxAutoRecoveryActions: 4,
      maxConsecutiveFailuresBeforePause: 3
    });

    const plan = manager.buildPlan(
      {
        thoughtSummary: "t",
        reasoning: "r",
        riskLevel: "safe",
        requiresConfirmation: false,
        successCriteria: "s",
        action: { name: "click", args: { elementId: "e-1" } }
      },
      "Timeout 30000ms exceeded",
      1
    );

    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.shouldPause).toBe(false);
  });

  it("requests pause when too many consecutive failures", () => {
    const manager = new RecoveryManager({
      enabled: true,
      retrySameActionOnTransientErrors: true,
      transientErrorKeywords: ["timeout"],
      popupDismissKey: "Escape",
      waitMsAfterFailure: 100,
      maxWaitMsAfterFailure: 1000,
      backoffMultiplier: 1.5,
      jitterRatio: 0,
      scrollRecoveryAmount: 300,
      maxAutoRecoveryActions: 4,
      maxConsecutiveFailuresBeforePause: 2
    });

    const plan = manager.buildPlan(
      {
        thoughtSummary: "t",
        reasoning: "r",
        riskLevel: "safe",
        requiresConfirmation: false,
        successCriteria: "s",
        action: { name: "click", args: { elementId: "e-1" } }
      },
      "error",
      2
    );

    expect(plan.shouldPause).toBe(true);
  });

  it("applies bounded backoff and deduplicates adjacent recovery actions", () => {
    const manager = new RecoveryManager({
      enabled: true,
      retrySameActionOnTransientErrors: true,
      transientErrorKeywords: ["timeout"],
      popupDismissKey: "Escape",
      waitMsAfterFailure: 100,
      maxWaitMsAfterFailure: 150,
      backoffMultiplier: 2,
      jitterRatio: 0,
      scrollRecoveryAmount: 300,
      maxAutoRecoveryActions: 6,
      maxConsecutiveFailuresBeforePause: 5
    });

    const plan = manager.buildPlan(
      {
        thoughtSummary: "t",
        reasoning: "r",
        riskLevel: "safe",
        requiresConfirmation: false,
        successCriteria: "s",
        action: { name: "press", args: { key: "Escape" } }
      },
      "Timeout 30000ms exceeded",
      4
    );

    const waits = plan.actions.filter((action) => action.name === "wait");
    const presses = plan.actions.filter((action) => action.name === "press");

    expect(plan.shouldPause).toBe(false);
    expect(waits.length).toBeGreaterThan(0);
    for (const item of waits) {
      expect(item.args.ms).toBe(150);
    }
    expect(presses.length).toBe(1);
  });
});
