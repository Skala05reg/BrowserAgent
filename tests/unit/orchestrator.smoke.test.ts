import { describe, expect, it } from "vitest";
import { AgentOrchestrator } from "../../src/core/orchestrator.js";
import { PauseController } from "../../src/core/pauseController.js";
import { ApprovalGate } from "../../src/core/approvalGate.js";
import { RuntimeConfig } from "../../src/config/types.js";

function createRuntimeConfig(): RuntimeConfig {
  return {
    agent: {
      maxSteps: 5,
      maxHistoryItems: 5,
      stepDelayMs: 0,
      decisionRetryCount: 0,
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
      typeActionAllowedInputTypes: ["text", "search", "email", "password", "tel", "url", "number"],
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
      connectionCheckMaxTokens: 20
    },
    safety: {
      requireConfirmationRiskLevels: ["destructive", "financial", "external_send"],
      keywordTriggers: []
    },
    logging: {
      jsonlPath: "logs/test-events.jsonl",
      debugTextPath: "logs/test-debug.txt",
      showObservationDetails: false,
      timeFormat: "iso",
      console: {
        visibleLevels: ["status", "action", "approval", "success", "warn", "error"],
        maxInlineValueLength: 120,
        maxInlineArrayItems: 4,
        maxInlineObjectKeys: 8,
        maxInlineLineLength: 220,
        neverTruncateKeys: ["summary", "question", "resumeHint", "text", "result"],
        actionStartLogActions: []
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
});
