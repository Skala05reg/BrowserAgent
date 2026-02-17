import { describe, expect, it } from "vitest";
import { buildDecisionUserPrompt } from "../../src/model/promptBuilder.js";

function extractTagContent(prompt: string, tag: string): string {
  const start = `<${tag}>`;
  const end = `</${tag}>`;
  const startIndex = prompt.indexOf(start);
  const endIndex = prompt.indexOf(end);
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Tag ${tag} not found`);
  }
  return prompt.slice(startIndex + start.length, endIndex);
}

describe("buildDecisionUserPrompt", () => {
  it("applies prompt limits to history, hints and element reasons", () => {
    const prompt = buildDecisionUserPrompt(
      {
        task: "тестовая задача",
        step: 3,
        history: [
          {
            step: 1,
            decision: {
              thoughtSummary: "первая мысль",
              reasoning: "первое рассуждение",
              riskLevel: "safe",
              requiresConfirmation: false,
              successCriteria: "ok",
              action: { name: "click", args: { elementId: "e-1" } }
            },
            actionResult: "abcdefghijklmnopqrstuvwxyz",
            actionSucceeded: true,
            observedUrl: "https://example.com/1",
            observedTitle: "one"
          },
          {
            step: 2,
            decision: {
              thoughtSummary: "вторая очень длинная мысль которая должна быть сокращена",
              reasoning: "второе очень длинное рассуждение которое тоже должно быть сокращено до лимита",
              riskLevel: "safe",
              requiresConfirmation: false,
              successCriteria: "ok",
              action: { name: "type", args: { elementId: "e-2", text: "hello" } }
            },
            actionResult: "zzzzzzzzzzzzzzzzzzzzzzzzzzzz",
            actionSucceeded: false,
            observedUrl: "https://example.com/2",
            observedTitle: "two"
          }
        ],
        snapshot: {
          url: "https://example.com",
          title: "Example",
          textExcerpt: "content",
          elements: []
        },
        contextPacket: {
          taskKeywords: ["test"],
          pageSummary: "summary",
          rankedElements: [
            {
              id: "e-2",
              tag: "a",
              role: "a",
              text: "Open",
              ariaLabel: "",
              placeholder: "",
              href: "https://example.com/next",
              disabled: false,
              score: 1,
              reasons: ["r1", "r2", "r3", "r4", "r5"]
            }
          ],
          attentionHints: ["h1", "h2", "h3"],
          compression: {
            totalElements: 3,
            selectedElements: 1
          }
        },
        route: {
          role: "action",
          roleInstruction: "do action",
          rationale: "because"
        }
      },
      {
        maxHistoryItems: 1,
        maxActionResultLength: 8,
        maxThoughtSummaryLength: 12,
        maxReasoningLength: 14,
        maxAttentionHints: 2,
        maxElementReasons: 3
      }
    );

    const history = JSON.parse(extractTagContent(prompt, "history")) as Array<Record<string, unknown>>;
    const hints = JSON.parse(extractTagContent(prompt, "attention_hints")) as string[];
    const elements = JSON.parse(extractTagContent(prompt, "elements")) as Array<Record<string, unknown>>;

    expect(history).toHaveLength(1);
    expect(history[0]?.step).toBe(2);
    expect(String(history[0]?.result)).toContain("...");
    expect(String(history[0]?.thoughtSummary)).toContain("...");
    expect(String(history[0]?.reasoning)).toContain("...");

    expect(hints).toEqual(["h1", "h2"]);
    expect((elements[0]?.reasons as unknown[]).length).toBe(3);
  });
});
