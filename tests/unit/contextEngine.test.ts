import { describe, expect, it } from "vitest";
import { ContextEngine } from "../../src/context/contextEngine.js";

describe("ContextEngine", () => {
  it("ranks relevant elements higher", () => {
    const engine = new ContextEngine({
      maxRankedElements: 5,
      maxTextExcerptForModel: 200,
      keywordMinLength: 3,
      recentHistoryDepth: 4,
      stopWords: ["и", "the"],
      scoreWeights: {
        textMatch: 3,
        ariaMatch: 2,
        placeholderMatch: 2,
        hrefMatch: 1,
        interactiveRoleBonus: 1,
        recentlyUsedBonus: 1,
        disabledPenalty: -2
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
});
