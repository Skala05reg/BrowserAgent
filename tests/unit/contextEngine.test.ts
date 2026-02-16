import { describe, expect, it } from "vitest";
import { ContextEngine } from "../../src/context/contextEngine.js";
import { AgentHistoryItem } from "../../src/core/types.js";

describe("ContextEngine", () => {
  it("ranks relevant elements higher", () => {
    const engine = new ContextEngine({
      maxRankedElements: 5,
      maxTextExcerptForModel: 200,
      keywordMinLength: 3,
      recentHistoryDepth: 4,
      stopWords: ["и", "the"],
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
    });

    const packet = engine.build(
      "найди кнопку оплатить заказ",
      {
        url: "https://example.com",
        title: "Checkout",
        textExcerpt: "checkout page",
        elements: [
          {
            id: "e-1",
            tag: "button",
            role: "button",
            text: "Оплатить заказ",
            placeholder: "",
            ariaLabel: "",
            href: "",
            value: "",
            disabled: false
          },
          {
            id: "e-2",
            tag: "a",
            role: "link",
            text: "О компании",
            placeholder: "",
            ariaLabel: "",
            href: "/about",
            value: "",
            disabled: false
          }
        ]
      },
      []
    );

    expect(packet.rankedElements[0]?.id).toBe("e-1");
    expect(packet.compression.selectedElements).toBeLessThanOrEqual(packet.compression.totalElements);
  });

  it("penalizes non-text inputs in ranking", () => {
    const engine = new ContextEngine({
      maxRankedElements: 5,
      maxTextExcerptForModel: 200,
      keywordMinLength: 3,
      recentHistoryDepth: 4,
      stopWords: ["и", "the"],
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
        nonTextInputPenalty: -4,
        lowSignalElementPenalty: -0.5
      }
    });

    const packet = engine.build(
      "найди фильтр вакансий",
      {
        url: "https://example.com",
        title: "Search",
        textExcerpt: "filters",
        elements: [
          {
            id: "e-1",
            tag: "input",
            role: "input",
            text: "",
            placeholder: "Поиск",
            ariaLabel: "",
            href: "",
            value: "",
            disabled: false,
            inputType: "text"
          },
          {
            id: "e-2",
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
      },
      []
    );

    expect(packet.rankedElements[0]?.id).toBe("e-1");
  });

  it("adds anti-loop hints from recent history", () => {
    const engine = new ContextEngine({
      maxRankedElements: 5,
      maxTextExcerptForModel: 200,
      keywordMinLength: 3,
      recentHistoryDepth: 6,
      stopWords: ["и", "the"],
      nonTextInputTypes: ["checkbox", "radio", "button", "submit"],
      loopHints: {
        historyWindow: 8,
        repeatActionThreshold: 3,
        sameUrlThreshold: 4,
        failedActionHintLimit: 3
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
    });

    const history: AgentHistoryItem[] = [
      {
        step: 1,
        decision: {
          thoughtSummary: "t",
          reasoning: "r",
          riskLevel: "safe",
          requiresConfirmation: false,
          successCriteria: "s",
          action: { name: "scroll", args: { direction: "up", amount: 1000 } }
        },
        actionResult: "Scrolled up",
        actionSucceeded: true,
        observedUrl: "https://example.com/search",
        observedTitle: "Search"
      },
      {
        step: 2,
        decision: {
          thoughtSummary: "t",
          reasoning: "r",
          riskLevel: "safe",
          requiresConfirmation: false,
          successCriteria: "s",
          action: { name: "scroll", args: { direction: "up", amount: 1000 } }
        },
        actionResult: "Scrolled up",
        actionSucceeded: true,
        observedUrl: "https://example.com/search",
        observedTitle: "Search"
      },
      {
        step: 3,
        decision: {
          thoughtSummary: "t",
          reasoning: "r",
          riskLevel: "safe",
          requiresConfirmation: false,
          successCriteria: "s",
          action: { name: "scroll", args: { direction: "up", amount: 1000 } }
        },
        actionResult: "type: element e-4 is not text-editable",
        actionSucceeded: false,
        observedUrl: "https://example.com/search",
        observedTitle: "Search"
      },
      {
        step: 4,
        decision: {
          thoughtSummary: "t",
          reasoning: "r",
          riskLevel: "safe",
          requiresConfirmation: false,
          successCriteria: "s",
          action: { name: "scroll", args: { direction: "up", amount: 1000 } }
        },
        actionResult: "Scrolled up",
        actionSucceeded: true,
        observedUrl: "https://example.com/search",
        observedTitle: "Search"
      }
    ];

    const packet = engine.build(
      "найди вакансии",
      {
        url: "https://example.com/search",
        title: "Search",
        textExcerpt: "results",
        elements: [
          {
            id: "e-1",
            tag: "a",
            role: "a",
            text: "Вакансия",
            placeholder: "",
            ariaLabel: "",
            href: "/vacancy/1",
            value: "",
            disabled: false
          }
        ]
      },
      history
    );

    expect(packet.attentionHints.some((item) => item.includes("Антицикл"))).toBe(true);
    expect(packet.attentionHints.some((item) => item.includes("Недавняя ошибка"))).toBe(true);
  });

  it("prefers main-content elements over header navigation", () => {
    const engine = new ContextEngine({
      maxRankedElements: 5,
      maxTextExcerptForModel: 200,
      keywordMinLength: 3,
      recentHistoryDepth: 4,
      stopWords: ["и", "the"],
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
        nonMainRegionPenalty: -3,
        disabledPenalty: -2,
        nonTextInputPenalty: -2,
        lowSignalElementPenalty: -0.5
      }
    });

    const packet = engine.build(
      "найди вакансии",
      {
        url: "https://example.com",
        title: "Search",
        textExcerpt: "results",
        elements: [
          {
            id: "e-1",
            tag: "a",
            role: "a",
            text: "Вакансии",
            placeholder: "",
            ariaLabel: "",
            href: "/menu/vacancies",
            value: "",
            disabled: false,
            region: "header"
          },
          {
            id: "e-2",
            tag: "a",
            role: "a",
            text: "Вакансии",
            placeholder: "",
            ariaLabel: "",
            href: "/search/vacancy",
            value: "",
            disabled: false,
            region: "main"
          }
        ]
      },
      []
    );

    expect(packet.rankedElements[0]?.id).toBe("e-2");
  });
});
