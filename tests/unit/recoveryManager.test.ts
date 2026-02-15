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
});
