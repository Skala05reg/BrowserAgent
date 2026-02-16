import { ContextConfig } from "../config/types.js";
import { AgentHistoryItem, PageElementDescriptor, PageSnapshot } from "../core/types.js";

export interface RankedElement {
  id: string;
  role: string;
  text: string;
  ariaLabel: string;
  placeholder: string;
  href: string;
  disabled: boolean;
  inputType?: string;
  name?: string;
  inViewport?: boolean;
  score: number;
  reasons: string[];
}

export interface ContextPacket {
  taskKeywords: string[];
  pageSummary: string;
  rankedElements: RankedElement[];
  attentionHints: string[];
  compression: {
    totalElements: number;
    selectedElements: number;
  };
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

export class ContextEngine {
  public constructor(private readonly config: ContextConfig) {}

  public build(task: string, snapshot: PageSnapshot, history: AgentHistoryItem[]): ContextPacket {
    const taskKeywords = this.extractTaskKeywords(task);
    const recentlyUsedIds = this.extractRecentlyUsedElementIds(history);
    const loopHints = this.buildLoopHints(history);

    const ranked = snapshot.elements
      .map((element) => this.rankElement(element, taskKeywords, recentlyUsedIds))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxRankedElements);

    return {
      taskKeywords,
      pageSummary: snapshot.textExcerpt.slice(0, this.config.maxTextExcerptForModel),
      rankedElements: ranked,
      attentionHints: this.buildAttentionHints(taskKeywords, ranked, loopHints),
      compression: {
        totalElements: snapshot.elements.length,
        selectedElements: ranked.length
      }
    };
  }

  private extractTaskKeywords(task: string): string[] {
    const unique = new Set<string>();

    for (const token of tokenize(task)) {
      if (token.length < this.config.keywordMinLength) {
        continue;
      }
      if (this.config.stopWords.includes(token)) {
        continue;
      }
      unique.add(token);
    }

    return Array.from(unique).slice(0, 24);
  }

  private extractRecentlyUsedElementIds(history: AgentHistoryItem[]): Set<string> {
    const ids = new Set<string>();

    for (const item of history.slice(-this.config.recentHistoryDepth)) {
      const elementId = item.decision.action.args.elementId;
      if (typeof elementId === "string" && elementId.length > 0) {
        ids.add(elementId);
      }
    }

    return ids;
  }

  private rankElement(element: PageElementDescriptor, taskKeywords: string[], recentlyUsedIds: Set<string>): RankedElement {
    const normalizedText = normalizeText([element.text, element.ariaLabel, element.placeholder, element.href].join(" "));
    const reasons: string[] = [];
    let score = 0;

    for (const keyword of taskKeywords) {
      if (element.text && normalizeText(element.text).includes(keyword)) {
        score += this.config.scoreWeights.textMatch;
        reasons.push(`text:${keyword}`);
      }
      if (element.ariaLabel && normalizeText(element.ariaLabel).includes(keyword)) {
        score += this.config.scoreWeights.ariaMatch;
        reasons.push(`aria:${keyword}`);
      }
      if (element.placeholder && normalizeText(element.placeholder).includes(keyword)) {
        score += this.config.scoreWeights.placeholderMatch;
        reasons.push(`placeholder:${keyword}`);
      }
      if (element.href && normalizeText(element.href).includes(keyword)) {
        score += this.config.scoreWeights.hrefMatch;
        reasons.push(`href:${keyword}`);
      }
    }

    const interactiveRoles = ["button", "textbox", "input", "a", "link", "select", "combobox", "textarea", "searchbox", "search"];
    if (interactiveRoles.includes(element.role.toLowerCase())) {
      score += this.config.scoreWeights.interactiveRoleBonus;
      reasons.push("interactive-role");
    }

    if (recentlyUsedIds.has(element.id)) {
      score += this.config.scoreWeights.recentlyUsedBonus;
      reasons.push("recently-used");
    }

    if (element.disabled) {
      score += this.config.scoreWeights.disabledPenalty;
      reasons.push("disabled");
    }

    if (element.tag.toLowerCase() === "input") {
      const inputType = (element.inputType ?? "").toLowerCase();
      if (inputType && this.config.nonTextInputTypes.includes(inputType)) {
        score += this.config.scoreWeights.nonTextInputPenalty;
        reasons.push(`non-text-input:${inputType}`);
      }
    }

    const lowSignal = [element.text, element.ariaLabel, element.placeholder, element.href, element.name ?? ""]
      .join("")
      .trim().length === 0;
    if (lowSignal) {
      score += this.config.scoreWeights.lowSignalElementPenalty;
      reasons.push("low-signal");
    }

    if (score <= 0 && normalizedText.length > 0) {
      score += 0.1;
    }

    return {
      ...element,
      score,
      reasons: reasons.slice(0, 6)
    };
  }

  private buildAttentionHints(taskKeywords: string[], rankedElements: RankedElement[], loopHints: string[]): string[] {
    const hints: string[] = [];

    if (rankedElements.length === 0) {
      hints.push("На странице нет видимых релевантных интерактивных элементов; сначала нужна дополнительная навигация или прокрутка.");
      return [...hints, ...loopHints];
    }

    const top = rankedElements.slice(0, 3);
    for (const item of top) {
      const label = item.text || item.ariaLabel || item.placeholder || item.href || item.id;
      hints.push(`Кандидат ${item.id}: ${label} (score=${item.score.toFixed(1)}; ${item.reasons.join(", ")})`);
    }

    hints.push(...loopHints);

    if (taskKeywords.length > 0) {
      hints.push(`Ключевые слова задачи: ${taskKeywords.join(", ")}`);
    }

    return hints;
  }

  private buildLoopHints(history: AgentHistoryItem[]): string[] {
    const recent = history.slice(-this.config.loopHints.historyWindow);
    if (recent.length === 0) {
      return [];
    }

    const hints: string[] = [];
    const last = recent.at(-1);
    if (last) {
      const signature = this.actionSignature(last.decision.action.name, last.decision.action.args);
      let actionStreak = 0;
      for (let index = recent.length - 1; index >= 0; index -= 1) {
        const item = recent[index];
        if (!item) {
          continue;
        }
        const currentSignature = this.actionSignature(item.decision.action.name, item.decision.action.args);
        if (currentSignature !== signature) {
          break;
        }
        actionStreak += 1;
      }

      if (actionStreak >= this.config.loopHints.repeatActionThreshold) {
        hints.push(`Антицикл: ${actionStreak} шага подряд повторяется ${last.decision.action.name}; выбери другой подход.`);
      }
    }

    const lastUrl = recent.at(-1)?.observedUrl;
    if (lastUrl) {
      let urlStreak = 0;
      for (let index = recent.length - 1; index >= 0; index -= 1) {
        const item = recent[index];
        if (!item || item.observedUrl !== lastUrl) {
          break;
        }
        urlStreak += 1;
      }

      if (urlStreak >= this.config.loopHints.sameUrlThreshold) {
        hints.push(`Антицикл: URL не меняется уже ${urlStreak} шагов; повтор кликов/скролла не помогает.`);
      }
    }

    const recentFailures = recent.filter((item) => !item.actionSucceeded).slice(-this.config.loopHints.failedActionHintLimit);
    for (const failed of recentFailures) {
      const detail = this.shorten(failed.actionResult, 140);
      hints.push(`Недавняя ошибка: step ${failed.step}, action=${failed.decision.action.name}, result=${detail}`);
    }

    return hints;
  }

  private actionSignature(name: string, args: Record<string, unknown>): string {
    return `${name}:${this.stableStringify(args)}`;
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${this.stableStringify(nested)}`).join(",")}}`;
  }

  private shorten(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
  }
}
