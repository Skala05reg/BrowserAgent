import { describe, expect, it } from "vitest";
import { ApprovalGate } from "../../src/core/approvalGate.js";

describe("ApprovalGate", () => {
  it("resolves approval request with approve", async () => {
    const gate = new ApprovalGate();
    const approvalPromise = gate.requestApproval({
      requestId: "req-1",
      step: 1,
      reason: "risk",
      decision: {
        thoughtSummary: "t",
        reasoning: "r",
        riskLevel: "destructive",
        requiresConfirmation: true,
        successCriteria: "s",
        action: { name: "click", args: { elementId: "e-1" } }
      }
    });

    const ok = gate.approve();
    expect(ok).toBe(true);
    await expect(approvalPromise).resolves.toBe(true);
  });

  it("returns false when no pending request", () => {
    const gate = new ApprovalGate();
    expect(gate.deny()).toBe(false);
  });
});
