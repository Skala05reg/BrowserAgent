import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../../src/core/orchestrator.js";
import { PauseController } from "../../src/core/pauseController.js";
import { ApprovalGate } from "../../src/core/approvalGate.js";
import { RuntimeConfig } from "../../src/config/types.js";

function createRuntimeConfig(): RuntimeConfig {
  return {
    agent: {
      maxSteps: 5,
      maxRunMs: 120000,
      maxHistoryItems: 5,
      stepDelayMs: 0,
      snapshotRetryDelayMs: 100,
      decisionRetryCount: 0,
      decisionRetryBaseDelayMs: 100,
      decisionRetryBackoffMultiplier: 1.5,
      decisionRetryJitterRatio: 0,
      maxDecisionRetryDelayMs: 1000,
      retryOnNonTransientDecisionErrors: false,
      slowStepWarnMs: 60_000,
      allowModelFallback: true,
      defaultStartUrl: "https://example.com",
      guards: {
        enabled: true,
        recentActionWindow: 6,
        maxRepeatedActionBeforeRewrite: 2,
        maxRepeatedScrollBeforeHotkey: 4,
        scrollBreakKeyUp: "Home",
        scrollBreakKeyDown: "End"
      }
    },
    browser: {
      headless: true,
      slowMoMs: 0,
      viewport: { width: 800, height: 600 },
      userDataDir: ".browser-profile",
      navigationTimeoutMs: 1000,
      navigationWaitUntil: "domcontentloaded",
      actionTimeoutMs: 1000,
      waitAfterActionMs: 0,
      clickFallbackToHrefOnTimeout: true,
      typeDelayMs: 0,
      defaultScrollAmountPx: 600,
      typeActionAllowedInputTypes: ["text", "search", "email", "password", "tel", "url", "number"],
      actionLimits: {
        maxTypeTextLength: 1200,
        maxScrollAmountPx: 3000,
        maxWaitMs: 10000,
        allowedNavigationProtocols: ["http:", "https:"],
        blockedHostPatterns: ["localhost"],
        allowPrivateNetworkHosts: false
      },
      snapshotWaitUntil: "domcontentloaded",
      snapshotWaitTimeoutMs: 500,
      adoptLatestPageOnNewTab: true,
      snapshot: {
        maxElements: 10,
        textExcerptLength: 200,
        includeInputs: true,
        includeButtons: true,
        includeLinks: true,
        includeHeadings: true,
        onlyViewportElements: true,
        viewportMarginPx: 80
      }
    },
    model: {
      provider: "rule_based",
      fallbackProvider: "rule_based",
      fallbackMode: "non_transient_only",
      apiBaseUrl: "https://example.com/v1",
      apiKeyEnv: "MODEL_API_KEY",
      modelNameEnv: "MODEL_NAME",
      providerEnv: "MODEL_PROVIDER",
      baseUrlEnv: "MODEL_API_BASE_URL",
      modelName: "glm-4.7",
      temperature: 0,
      maxTokens: 200,
      requestTimeoutMs: 1000,
      transientErrorKeywords: ["timeout", "rate limit"],
      connectionCheckSystemPrompt: "system",
      connectionCheckUserPrompt: "user",
      connectionCheckMaxTokens: 20,
      promptLimits: {
        maxHistoryItems: 6,
        maxActionResultLength: 200,
        maxThoughtSummaryLength: 120,
        maxReasoningLength: 160,
        maxAttentionHints: 4,
        maxElementReasons: 3
      },
      circuitBreaker: {
        enabled: true,
        failureThreshold: 2,
        cooldownMs: 2000,
        tripOnTransientOnly: false
      }
    },
    safety: {
      requireConfirmationRiskLevels: ["destructive", "financial", "external_send"],
      keywordTriggers: []
    },
    logging: {
      jsonlPath: "logs/test-events.jsonl",
      debugTextPath: "logs/test-debug.txt",
      jsonlIncludeMonitorData: false,
      jsonlIncludeDebugData: false,
      showObservationDetails: false,
      timeFormat: "iso",
      rotation: {
        enabled: true,
        maxFileSizeBytes: 10_000,
        maxArchiveFiles: 2
      },
      redaction: {
        enabled: true,
        keys: ["token", "password", "authorization", "cookie"],
        mask: "***REDACTED***"
      },
      console: {
        visibleLevels: ["status", "action", "approval", "success", "warn", "error"],
        maxInlineValueLength: 120,
        maxInlineArrayItems: 4,
        maxInlineObjectKeys: 8,
        maxInlineLineLength: 220,
        neverTruncateKeys: ["summary", "question", "resumeHint", "text", "result"],
        actionStartLogActions: [],
        decisionDigest: {
          enabled: true,
          mode: "on_change",
          repeatReminderEvery: 4,
          thoughtMaxLength: 150,
          reasoningMaxLength: 150,
          successCriteriaMaxLength: 130
        }
      },
      colors: {
        system: "cyan",
        status: "blue",
        observation: "gray",
        decision: "magenta",
        action: "blueBright",
        approval: "yellow",
        success: "green",
        warn: "yellowBright",
        error: "redBright"
      }
    },
    cli: {
      banner: [],
      prompt: "agent> ",
      unknownCommandMessage: "unknown",
      busyMessage: "busy",
      idleMessage: "idle"
    },
    prompts: {
      system: "system",
      outputSchemaHint: "json",
      actionPolicy: "policy"
    },
    context: {
      maxRankedElements: 5,
      maxTextExcerptForModel: 120,
      keywordMinLength: 3,
      recentHistoryDepth: 4,
      stopWords: ["and", "the"],
      nonTextInputTypes: ["checkbox", "radio", "button", "submit"],
      loopHints: {
        historyWindow: 6,
        repeatActionThreshold: 3,
        sameUrlThreshold: 4,
        failedActionHintLimit: 2
      },
      scoreWeights: {
        textMatch: 3,
        ariaMatch: 2,
        placeholderMatch: 2,
        hrefMatch: 1,
        interactiveRoleBonus: 1,
        recentlyUsedBonus: 1,
        repeatedRecentUsePenalty: -0.5,
        recentlyFailedPenalty: -1,
        nonMainRegionPenalty: -1,
        disabledPenalty: -2,
        nonTextInputPenalty: -2,
        lowSignalElementPenalty: -0.5
      }
    },
    subAgents: {
      enabled: true,
      roles: {
        navigator: "nav",
        extractor: "extract",
        action: "act",
        verifier: "verify"
      }
    },
    recovery: {
      enabled: true,
      retrySameActionOnTransientErrors: true,
      transientErrorKeywords: ["timeout"],
      popupDismissKey: "Escape",
      waitMsAfterFailure: 0,
      maxWaitMsAfterFailure: 2000,
      backoffMultiplier: 1.5,
      jitterRatio: 0,
      scrollRecoveryAmount: 120,
      maxAutoRecoveryActions: 2,
      maxConsecutiveFailuresBeforePause: 3
    }
  };
}

describe("AgentOrchestrator smoke", () => {
  it("completes basic two-step task", async () => {
    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    let decideCall = 0;
    const modelGateway = {
      decide: async () => {
        decideCall += 1;
        if (decideCall === 1) {
          return {
            thoughtSummary: "click first",
            reasoning: "r",
            riskLevel: "safe" as const,
            requiresConfirmation: false,
            successCriteria: "clicked",
            action: { name: "click" as const, args: { elementId: "e-1" } }
          };
        }
        return {
          thoughtSummary: "done",
          reasoning: "r",
          riskLevel: "safe" as const,
          requiresConfirmation: false,
          successCriteria: "done",
          action: { name: "finish" as const, args: { summary: "ok" } }
        };
      }
    };

    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => ({
        url: "https://example.com",
        title: "Example",
        textExcerpt: "test page",
        elements: [
          {
            id: "e-1",
            tag: "button",
            role: "button",
            text: "Continue",
            placeholder: "",
            ariaLabel: "",
            href: "",
            value: "",
            disabled: false
          }
        ]
      })
    };

    const tools = {
      execute: async (action: { name: string }) => ({
        ok: true,
        message: `executed ${action.name}`
      })
    };

    const orchestrator = new AgentOrchestrator(
      createRuntimeConfig(),
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const result = await orchestrator.runTask("test task");

    expect(result.status).toBe("completed");
    expect(result.summary).toBe("ok");
    expect(result.stepsExecuted).toBe(2);
  });

  it("uses finish.text as final summary when summary is absent", async () => {
    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    const modelGateway = {
      decide: async () => ({
        thoughtSummary: "done",
        reasoning: "r",
        riskLevel: "safe" as const,
        requiresConfirmation: false,
        successCriteria: "done",
        action: {
          name: "finish" as const,
          args: { text: "итог из text" }
        }
      })
    };

    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => ({
        url: "https://example.com",
        title: "Example",
        textExcerpt: "test page",
        elements: []
      })
    };

    const tools = {
      execute: async () => ({
        ok: true,
        message: "ok"
      })
    };

    const orchestrator = new AgentOrchestrator(
      createRuntimeConfig(),
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const result = await orchestrator.runTask("test task");

    expect(result.status).toBe("completed");
    expect(result.summary).toBe("итог из text");
    expect(result.stepsExecuted).toBe(1);
  });

  it("rewrites type on checkbox to click", async () => {
    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    let decideCall = 0;
    const modelGateway = {
      decide: async () => {
        decideCall += 1;
        if (decideCall === 1) {
          return {
            thoughtSummary: "type",
            reasoning: "r",
            riskLevel: "safe" as const,
            requiresConfirmation: false,
            successCriteria: "typed",
            action: { name: "type" as const, args: { elementId: "e-1", text: "ML" } }
          };
        }

        return {
          thoughtSummary: "done",
          reasoning: "r",
          riskLevel: "safe" as const,
          requiresConfirmation: false,
          successCriteria: "done",
          action: { name: "finish" as const, args: { summary: "ok" } }
        };
      }
    };

    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => ({
        url: "https://example.com",
        title: "Example",
        textExcerpt: "test page",
        elements: [
          {
            id: "e-1",
            tag: "input",
            role: "input",
            text: "",
            placeholder: "",
            ariaLabel: "",
            href: "",
            value: "",
            disabled: false,
            inputType: "checkbox"
          }
        ]
      })
    };

    const executedActions: string[] = [];
    const tools = {
      execute: async (action: { name: string }) => {
        executedActions.push(action.name);
        return {
          ok: true,
          message: `executed ${action.name}`
        };
      }
    };

    const orchestrator = new AgentOrchestrator(
      createRuntimeConfig(),
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const result = await orchestrator.runTask("test task");

    expect(result.status).toBe("completed");
    expect(executedActions[0]).toBe("click");
  });

  it("rewrites repeated click to navigate by href", async () => {
    const config = createRuntimeConfig();
    config.agent.guards.maxRepeatedActionBeforeRewrite = 1;

    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    let decideCall = 0;
    const modelGateway = {
      decide: async () => {
        decideCall += 1;
        if (decideCall <= 2) {
          return {
            thoughtSummary: "click",
            reasoning: "r",
            riskLevel: "safe" as const,
            requiresConfirmation: false,
            successCriteria: "clicked",
            action: { name: "click" as const, args: { elementId: "e-1" } }
          };
        }

        return {
          thoughtSummary: "done",
          reasoning: "r",
          riskLevel: "safe" as const,
          requiresConfirmation: false,
          successCriteria: "done",
          action: { name: "finish" as const, args: { summary: "ok" } }
        };
      }
    };

    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => ({
        url: "https://example.com/list",
        title: "List",
        textExcerpt: "test page",
        elements: [
          {
            id: "e-1",
            tag: "a",
            role: "a",
            text: "Open",
            placeholder: "",
            ariaLabel: "",
            href: "https://example.com/item/1",
            value: "",
            disabled: false
          }
        ]
      })
    };

    const executedActions: string[] = [];
    const tools = {
      execute: async (action: { name: string }) => {
        executedActions.push(action.name);
        return {
          ok: true,
          message: `executed ${action.name}`
        };
      }
    };

    const orchestrator = new AgentOrchestrator(
      config,
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const result = await orchestrator.runTask("test task");

    expect(result.status).toBe("completed");
    expect(executedActions[0]).toBe("click");
    expect(executedActions[1]).toBe("navigate");
  });

  it("stops immediately after pause wait without executing an extra step", async () => {
    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    let snapshotCalls = 0;
    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => {
        snapshotCalls += 1;
        return {
          url: "https://example.com",
          title: "Example",
          textExcerpt: "test page",
          elements: []
        };
      }
    };

    let decideCalls = 0;
    const modelGateway = {
      decide: async () => {
        decideCalls += 1;
        if (decideCalls === 1) {
          return {
            thoughtSummary: "need user",
            reasoning: "r",
            riskLevel: "safe" as const,
            requiresConfirmation: false,
            successCriteria: "ask",
            action: { name: "ask_user" as const, args: { question: "confirm" } }
          };
        }
        return {
          thoughtSummary: "done",
          reasoning: "r",
          riskLevel: "safe" as const,
          requiresConfirmation: false,
          successCriteria: "done",
          action: { name: "finish" as const, args: { summary: "ok" } }
        };
      }
    };

    const tools = {
      execute: async () => ({
        ok: true,
        message: "ok"
      })
    };

    const orchestrator = new AgentOrchestrator(
      createRuntimeConfig(),
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const taskPromise = orchestrator.runTask("test task");

    for (let index = 0; index < 100; index += 1) {
      if (orchestrator.getStatus().paused) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(orchestrator.getStatus().paused).toBe(true);
    orchestrator.stop();

    const result = await taskPromise;
    expect(result.status).toBe("stopped");
    expect(result.stepsExecuted).toBe(1);
    expect(snapshotCalls).toBe(1);
    expect(decideCalls).toBe(1);
  });

  it("retries transient decision errors and succeeds", async () => {
    const config = createRuntimeConfig();
    config.agent.decisionRetryCount = 2;
    config.agent.decisionRetryBaseDelayMs = 0;
    config.agent.retryOnNonTransientDecisionErrors = false;

    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => ({
        url: "https://example.com",
        title: "Example",
        textExcerpt: "test page",
        elements: []
      })
    };

    let decideCalls = 0;
    const modelGateway = {
      decide: async () => {
        decideCalls += 1;
        if (decideCalls === 1) {
          throw new Error("timeout while requesting model");
        }
        return {
          thoughtSummary: "done",
          reasoning: "r",
          riskLevel: "safe" as const,
          requiresConfirmation: false,
          successCriteria: "done",
          action: { name: "finish" as const, args: { summary: "ok" } }
        };
      }
    };

    const tools = {
      execute: async () => ({
        ok: true,
        message: "ok"
      })
    };

    const orchestrator = new AgentOrchestrator(
      config,
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const result = await orchestrator.runTask("test task");
    expect(result.status).toBe("completed");
    expect(decideCalls).toBe(2);
  });

  it("fails fast on non-transient decision error when non-transient retries are disabled", async () => {
    const config = createRuntimeConfig();
    config.agent.decisionRetryCount = 3;
    config.agent.decisionRetryBaseDelayMs = 0;
    config.agent.retryOnNonTransientDecisionErrors = false;

    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => ({
        url: "https://example.com",
        title: "Example",
        textExcerpt: "test page",
        elements: []
      })
    };

    let decideCalls = 0;
    const modelGateway = {
      decide: async () => {
        decideCalls += 1;
        throw new Error("schema validation failed");
      }
    };

    const tools = {
      execute: async () => ({
        ok: true,
        message: "ok"
      })
    };

    const orchestrator = new AgentOrchestrator(
      config,
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const result = await orchestrator.runTask("test task");
    expect(result.status).toBe("failed");
    expect(result.summary).toContain("schema validation failed");
    expect(decideCalls).toBe(1);
  });

  it("retries non-transient decision errors when explicitly enabled", async () => {
    const config = createRuntimeConfig();
    config.agent.decisionRetryCount = 2;
    config.agent.decisionRetryBaseDelayMs = 0;
    config.agent.retryOnNonTransientDecisionErrors = true;

    const logger = {
      system: () => undefined,
      status: () => undefined,
      observation: () => undefined,
      decision: () => undefined,
      action: () => undefined,
      approval: () => undefined,
      success: () => undefined,
      warn: () => undefined,
      error: () => undefined
    };

    const browserRuntime = {
      start: async () => undefined,
      getSnapshot: async () => ({
        url: "https://example.com",
        title: "Example",
        textExcerpt: "test page",
        elements: []
      })
    };

    let decideCalls = 0;
    const modelGateway = {
      decide: async () => {
        decideCalls += 1;
        if (decideCalls <= 2) {
          throw new Error("model returned invalid shape");
        }
        return {
          thoughtSummary: "done",
          reasoning: "r",
          riskLevel: "safe" as const,
          requiresConfirmation: false,
          successCriteria: "done",
          action: { name: "finish" as const, args: { summary: "ok" } }
        };
      }
    };

    const tools = {
      execute: async () => ({
        ok: true,
        message: "ok"
      })
    };

    const orchestrator = new AgentOrchestrator(
      config,
      logger as never,
      browserRuntime as never,
      tools as never,
      modelGateway as never,
      new PauseController(),
      new ApprovalGate()
    );

    const result = await orchestrator.runTask("test task");
    expect(result.status).toBe("completed");
    expect(decideCalls).toBe(3);
  });
});
