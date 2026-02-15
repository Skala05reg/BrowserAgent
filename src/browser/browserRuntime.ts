import path from "node:path";
import { chromium, BrowserContext, Page } from "playwright";
import { BrowserConfig } from "../config/types.js";
import { PageSnapshot, ToolExecutionResult } from "../core/types.js";

interface InternalElement {
  id: string;
  selector: string;
}

interface SnapshotPayload {
  url: string;
  title: string;
  textExcerpt: string;
  elements: Array<{
    id: string;
    tag: string;
    role: string;
    text: string;
    placeholder: string;
    ariaLabel: string;
    href: string;
    value: string;
    disabled: boolean;
    selector: string;
  }>;
}

export class BrowserRuntime {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private elementMap = new Map<string, InternalElement>();

  public constructor(private readonly config: BrowserConfig) {}

  public async start(): Promise<void> {
    if (this.context) {
      return;
    }

    const userDataDir = path.resolve(process.cwd(), this.config.userDataDir);
    this.context = await chromium.launchPersistentContext(userDataDir, {
      headless: this.config.headless,
      viewport: this.config.viewport,
      slowMo: this.config.slowMoMs
    });

    this.page = this.context.pages().at(0) ?? (await this.context.newPage());
    this.page.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    this.page.setDefaultTimeout(this.config.actionTimeoutMs);
  }

  public async stop(): Promise<void> {
    if (!this.context) {
      return;
    }
    await this.context.close();
    this.context = null;
    this.page = null;
    this.elementMap.clear();
  }

  public async ensurePage(): Promise<Page> {
    if (!this.page) {
      await this.start();
    }

    if (!this.page) {
      throw new Error("Browser page is not initialized");
    }

    return this.page;
  }

  public async getSnapshot(): Promise<PageSnapshot> {
    const page = await this.ensurePage();

    const payload = await page.evaluate(
      ({ maxElements, textExcerptLength, includeInputs, includeButtons, includeLinks, includeHeadings }) => {
        function toSelector(element: Element): string {
          const html = element as HTMLElement;
          if (html.id) {
            return `#${CSS.escape(html.id)}`;
          }

          const parts: string[] = [];
          let cursor: Element | null = element;
          while (cursor && parts.length < 6) {
            let selector = cursor.tagName.toLowerCase();
            const parent: Element | null = cursor.parentElement;
            if (parent) {
              const siblings: Element[] = Array.from(parent.children).filter(
                (item: Element) => item.tagName === cursor?.tagName
              );
              if (siblings.length > 1) {
                const index = siblings.indexOf(cursor) + 1;
                selector += `:nth-of-type(${index})`;
              }
            }
            parts.unshift(selector);
            cursor = parent;
          }
          return parts.join(" > ");
        }

        function isVisible(element: Element): boolean {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return false;
          }

          const style = window.getComputedStyle(element);
          return style.visibility !== "hidden" && style.display !== "none";
        }

        const selectors: string[] = [];
        if (includeButtons) {
          selectors.push("button", "[role='button']", "input[type='button']", "input[type='submit']");
        }
        if (includeLinks) {
          selectors.push("a[href]");
        }
        if (includeInputs) {
          selectors.push("input", "textarea", "select", "[contenteditable='true']");
        }
        if (includeHeadings) {
          selectors.push("h1", "h2", "h3");
        }

        const nodes: Element[] = Array.from(document.querySelectorAll(selectors.join(",")))
          .filter((item: Element) => isVisible(item))
          .slice(0, maxElements);

        const elements = nodes.map((node, index) => {
          const html = node as HTMLInputElement;
          const id = `e-${index + 1}`;
          const role = node.getAttribute("role") ?? node.tagName.toLowerCase();
          const text = (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

          return {
            id,
            tag: node.tagName.toLowerCase(),
            role,
            text,
            placeholder: html.placeholder ?? "",
            ariaLabel: node.getAttribute("aria-label") ?? "",
            href: (node as HTMLAnchorElement).href ?? "",
            value: html.value ?? "",
            disabled: Boolean((node as HTMLButtonElement).disabled),
            selector: toSelector(node)
          };
        });

        const bodyText = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();

        return {
          url: location.href,
          title: document.title,
          textExcerpt: bodyText.slice(0, textExcerptLength),
          elements
        };
      },
      this.config.snapshot
    );

    const typedPayload = payload as SnapshotPayload;

    this.elementMap.clear();
    for (const item of typedPayload.elements) {
      this.elementMap.set(item.id, { id: item.id, selector: item.selector });
    }

    return {
      url: typedPayload.url,
      title: typedPayload.title,
      textExcerpt: typedPayload.textExcerpt,
      elements: typedPayload.elements.map(({ selector: _selector, ...rest }) => rest)
    };
  }

  public async executeBrowserAction(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const page = await this.ensurePage();

    switch (name) {
      case "navigate": {
        const url = String(args.url ?? "").trim();
        if (!url) {
          return { ok: false, message: "navigate: empty url" };
        }
        await page.goto(url);
        await page.waitForTimeout(this.config.waitAfterActionMs);
        return { ok: true, message: `Opened ${url}` };
      }
      case "click": {
        const elementId = String(args.elementId ?? "").trim();
        const selector = this.resolveSelector(elementId);
        await page.locator(selector).first().click({ timeout: this.config.actionTimeoutMs });
        await page.waitForTimeout(this.config.waitAfterActionMs);
        return { ok: true, message: `Clicked ${elementId}` };
      }
      case "type": {
        const elementId = String(args.elementId ?? "").trim();
        const text = String(args.text ?? "");
        const clear = args.clear !== false;
        const selector = this.resolveSelector(elementId);
        const locator = page.locator(selector).first();
        await locator.click({ timeout: this.config.actionTimeoutMs });
        if (clear) {
          await locator.fill("");
        }
        await locator.type(text, { delay: 10 });
        await page.waitForTimeout(this.config.waitAfterActionMs);
        return { ok: true, message: `Typed into ${elementId}` };
      }
      case "press": {
        const key = String(args.key ?? "Enter");
        await page.keyboard.press(key);
        await page.waitForTimeout(this.config.waitAfterActionMs);
        return { ok: true, message: `Pressed ${key}` };
      }
      case "scroll": {
        const direction = String(args.direction ?? "down");
        const amount = Number(args.amount ?? 600);
        const y = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
        await page.evaluate((delta) => window.scrollBy({ top: delta, behavior: "smooth" }), y);
        await page.waitForTimeout(this.config.waitAfterActionMs);
        return { ok: true, message: `Scrolled ${direction} ${Math.abs(y)}px` };
      }
      case "wait": {
        const ms = Number(args.ms ?? this.config.waitAfterActionMs);
        await page.waitForTimeout(ms);
        return { ok: true, message: `Waited ${ms}ms` };
      }
      default:
        return { ok: false, message: `Unsupported browser action: ${name}` };
    }
  }

  private resolveSelector(elementId: string): string {
    const element = this.elementMap.get(elementId);
    if (!element) {
      throw new Error(`Unknown elementId: ${elementId}. Request a new snapshot first.`);
    }
    return element.selector;
  }
}
