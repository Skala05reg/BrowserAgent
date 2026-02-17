import { DecisionInput } from "./modelGateway.js";
import { ModelPromptLimitsConfig } from "../config/types.js";

function shorten(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  if (maxLength <= 3) {
    return normalized.slice(0, maxLength);
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

export function buildDecisionUserPrompt(input: DecisionInput, limits: ModelPromptLimitsConfig): string {
  const compactElements = input.contextPacket.rankedElements.map((item) => ({
    id: item.id,
    role: item.role,
    text: item.text,
    placeholder: item.placeholder,
    ariaLabel: item.ariaLabel,
    href: item.href,
    rawHref: item.rawHref ?? "",
    disabled: item.disabled,
    inputType: item.inputType ?? "",
    name: item.name ?? "",
    domId: item.domId ?? "",
    region: item.region ?? "unknown",
    inViewport: item.inViewport ?? true,
    score: item.score,
    reasons: item.reasons.slice(0, limits.maxElementReasons)
  }));

  const compactHistory = input.history
    .slice(-limits.maxHistoryItems)
    .map((item) => ({
      step: item.step,
      action: item.decision.action,
      result: shorten(item.actionResult, limits.maxActionResultLength),
      success: item.actionSucceeded,
      url: item.observedUrl,
      title: item.observedTitle,
      thoughtSummary: shorten(item.decision.thoughtSummary, limits.maxThoughtSummaryLength),
      reasoning: shorten(item.decision.reasoning, limits.maxReasoningLength),
      risk: item.decision.riskLevel
    }));

  const attentionHints = input.contextPacket.attentionHints.slice(0, limits.maxAttentionHints);

  return [
    `<task>${input.task}</task>`,
    `<step>${input.step}</step>`,
    `<sub_agent role="${input.route.role}" rationale="${input.route.rationale}">${input.route.roleInstruction}</sub_agent>`,
    `<page url="${input.snapshot.url}" title="${input.snapshot.title}">`,
    `<summary>${input.contextPacket.pageSummary}</summary>`,
    `<attention_hints>${JSON.stringify(attentionHints)}</attention_hints>`,
    `<elements>${JSON.stringify(compactElements)}</elements>`,
    `<compression>${JSON.stringify(input.contextPacket.compression)}</compression>`,
    `</page>`,
    `<history>${JSON.stringify(compactHistory)}</history>`,
    "Ответ верни JSON-объектом с полями: thoughtSummary, reasoning, riskLevel, requiresConfirmation, successCriteria, action{name,args}."
  ].join("\n");
}
