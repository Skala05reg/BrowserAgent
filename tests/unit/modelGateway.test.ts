import { describe, expect, it, vi } from "vitest";
import { loadRuntimeConfig } from "../../src/config/loadConfig.js";
import { ModelGateway } from "../../src/model/modelGateway.js";
import { AgentDecision } from "../../src/core/types.js";

function createDecision(actionName: AgentDecision["action"]["name"] = "wait"): AgentDecision {
  return {
    thoughtSummary: "t",
    reasoning: "r",
    riskLevel: "safe",
    requiresConfirmation: false,
    successCriteria: "s",
    action: {
      name: actionName,
      args: actionName === "wait" ? { ms: 10 } : {}
    }
  };
}

function createDecisionInput() {
  return {
    task: "test",
    step: 1,
    history: [],
    snapshot: {
      url: "about:blank",
      title: "",
      textExcerpt: "",
      elements: []
    },
    contextPacket: {
      taskKeywords: [],
      pageSummary: "",
      rankedElements: [],
      attentionHints: [],
      compression: {
        totalElements: 0,
        selectedElements: 0
      }
    },
    route: {
      role: "action" as const,
      roleInstruction: "act",
      rationale: "r"
    }
  };
}

describe("ModelGateway", () => {
  it("opens circuit breaker after threshold and skips primary during cooldown", async () => {
    const config = loadRuntimeConfig();
    config.agent.allowModelFallback = true;
    config.model.fallbackMode = "always";
    config.model.circuitBreaker.enabled = true;
    config.model.circuitBreaker.failureThreshold = 2;
    config.model.circuitBreaker.cooldownMs = 60_000;
    config.model.circuitBreaker.tripOnTransientOnly = false;

    const input = createDecisionInput();
    const fallbackDecision = createDecision();

    const primary = {
      decide: vi.fn(async () => {
        throw new Error("primary unavailable");
      })
    };
    const fallback = {
      decide: vi.fn(async () => fallbackDecision)
    };

    const gateway = new ModelGateway(config, undefined, { primary, fallback });

    await expect(gateway.decide(input)).resolves.toEqual(fallbackDecision);
    await expect(gateway.decide(input)).resolves.toEqual(fallbackDecision);
    await expect(gateway.decide(input)).resolves.toEqual(fallbackDecision);

    expect(primary.decide).toHaveBeenCalledTimes(2);
    expect(fallback.decide).toHaveBeenCalledTimes(3);
  });

  it("keeps non_transient_only fallback behavior for transient errors", async () => {
    const config = loadRuntimeConfig();
    config.agent.allowModelFallback = true;
    config.model.fallbackMode = "non_transient_only";
    config.model.circuitBreaker.enabled = true;
    config.model.circuitBreaker.failureThreshold = 2;
    config.model.circuitBreaker.cooldownMs = 60_000;
    config.model.circuitBreaker.tripOnTransientOnly = false;
    config.model.transientErrorKeywords = ["timeout"];

    const input = createDecisionInput();

    const primary = {
      decide: vi.fn(async () => {
        throw new Error("Timeout while requesting model");
      })
    };
    const fallback = {
      decide: vi.fn(async () => createDecision())
    };

    const gateway = new ModelGateway(config, undefined, { primary, fallback });
    await expect(gateway.decide(input)).rejects.toThrow(/timeout/i);
    expect(primary.decide).toHaveBeenCalledTimes(1);
    expect(fallback.decide).toHaveBeenCalledTimes(0);
  });
});
