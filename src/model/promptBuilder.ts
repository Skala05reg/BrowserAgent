import { DecisionInput } from "./modelGateway.js";

export function buildDecisionUserPrompt(input: DecisionInput): string {
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
    reasons: item.reasons
  }));

  const compactHistory = input.history.map((item) => ({
    step: item.step,
    action: item.decision.action,
    result: item.actionResult,
    success: item.actionSucceeded,
    url: item.observedUrl,
    title: item.observedTitle,
    thoughtSummary: item.decision.thoughtSummary,
    risk: item.decision.riskLevel
  }));

  return [
    `<task>${input.task}</task>`,
    `<step>${input.step}</step>`,
    `<sub_agent role="${input.route.role}" rationale="${input.route.rationale}">${input.route.roleInstruction}</sub_agent>`,
    `<page url="${input.snapshot.url}" title="${input.snapshot.title}">`,
    `<summary>${input.contextPacket.pageSummary}</summary>`,
    `<attention_hints>${JSON.stringify(input.contextPacket.attentionHints)}</attention_hints>`,
    `<elements>${JSON.stringify(compactElements)}</elements>`,
    `<compression>${JSON.stringify(input.contextPacket.compression)}</compression>`,
    `</page>`,
    `<history>${JSON.stringify(compactHistory)}</history>`,
    "Ответ верни JSON-объектом с полями: thoughtSummary, reasoning, riskLevel, requiresConfirmation, successCriteria, action{name,args}."
  ].join("\n");
}
