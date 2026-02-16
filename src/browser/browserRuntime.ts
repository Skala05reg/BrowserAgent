import path from "node:path";
import { chromium, BrowserContext, Locator, Page } from "playwright";
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
    inputType: string;
    name: string;
    inViewport: boolean;
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
    this.applyPageTimeouts(this.page);

    if (this.config.adoptLatestPageOnNewTab) {
      this.context.on("page", (newPage) => {
        this.page = newPage;
        this.applyPageTimeouts(newPage);
      });
    }
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
    this.syncPageReference();

    if (!this.page) {
      await this.start();
      this.syncPageReference();
    }

    if (!this.page) {
      throw new Error("Browser page is not initialized");
    }

    return this.page;
  }

  public async getSnapshot(): Promise<PageSnapshot> {
    const page = await this.ensurePage();

    // Soft wait: enough for stable DOM without waiting full heavy asset load.
    try {
      await page.waitForLoadState(this.config.snapshotWaitUntil, { timeout: this.config.snapshotWaitTimeoutMs });
    } catch (_error) {
      // Ignore timeout and capture snapshot from current DOM state.
    }

    const payload = await page.evaluate(
      ({
        maxElements,
        textExcerptLength,
        includeInputs,
        includeButtons,
        includeLinks,
        includeHeadings,
        onlyViewportElements,
        viewportMarginPx
      }) => {
        // Fix for tsx/esbuild injecting __name which is not defined in the browser
        const _anyWin = window as any;
        if (typeof _anyWin.__name === "undefined") {
          _anyWin.__name = (f: any) => f;
        }

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

        function isInViewport(element: Element, margin: number): boolean {
          const rect = element.getBoundingClientRect();
          return (
            rect.bottom >= -margin &&
            rect.right >= -margin &&
            rect.top <= window.innerHeight + margin &&
            rect.left <= window.innerWidth + margin
          );
        }

        function normalize(value: string): string {
          return value.replace(/\s+/g, " ").trim();
        }

        function deriveText(node: Element): string {
          const textContent = normalize(node.textContent ?? "");
          if (textContent) {
            return textContent;
          }

          if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement || node instanceof HTMLSelectElement) {
            const labelText = Array.from(node.labels ?? [])
              .map((item) => normalize(item.textContent ?? ""))
              .filter(Boolean)
              .join(" ");
            if (labelText) {
              return labelText;
            }
          }

          const title = normalize(node.getAttribute("title") ?? "");
          if (title) {
            return title;
          }

          return "";
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
          .filter((item: Element) => !onlyViewportElements || isInViewport(item, viewportMarginPx))
          .slice(0, maxElements);

        const elements = nodes.map((node, index) => {
          const html = node as HTMLInputElement;
          const id = `e-${index + 1}`;
          const role = node.getAttribute("role") ?? node.tagName.toLowerCase();
          const text = deriveText(node).slice(0, 160);
          const inputType = node instanceof HTMLInputElement ? (node.type ?? "").toLowerCase() : "";
          const name = typeof html.name === "string" ? html.name : "";

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
            inputType,
            name,
            inViewport: isInViewport(node, viewportMarginPx),
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
        const message = await this.openUrlWithTolerance(page, url);
        await page.waitForTimeout(this.config.waitAfterActionMs);
        return { ok: true, message };
      }
      case "click": {
        const elementId = String(args.elementId ?? "").trim();
        const selector = this.resolveSelector(elementId);
        const locator = page.locator(selector).first();
        try {
          await locator.click({ timeout: this.config.actionTimeoutMs });
        } catch (error) {
          if (this.config.clickFallbackToHrefOnTimeout && this.isNavigationTimeout(error)) {
            const fallbackHref = await this.resolveHrefFromLocator(page, locator);
            if (fallbackHref) {
              const message = await this.openUrlWithTolerance(page, fallbackHref);
              await page.waitForTimeout(this.config.waitAfterActionMs);
              return {
                ok: true,
                message: `Clicked ${elementId} (fallback to href). ${message}`
              };
            }
          }
          throw error;
        }
        await page.waitForTimeout(this.config.waitAfterActionMs);
        return { ok: true, message: `Clicked ${elementId}` };
      }
      case "type": {
        const elementId = String(args.elementId ?? "").trim();
        const text = String(args.text ?? "");
        const clear = args.clear !== false;
        const selector = this.resolveSelector(elementId);
        const locator = page.locator(selector).first();
        const meta = await locator.evaluate((element) => {
          const html = element as HTMLInputElement;
          const tag = element.tagName.toLowerCase();
          const role = element.getAttribute("role") ?? tag;
          const inputType = element instanceof HTMLInputElement ? (element.type ?? "").toLowerCase() : "";
          const contentEditable = element instanceof HTMLElement ? element.isContentEditable : false;

          return {
            tag,
            role: role.toLowerCase(),
            inputType,
            disabled: Boolean((html as HTMLButtonElement).disabled),
            contentEditable
          };
        });

        if (!this.isTextEditableElement(meta)) {
          return {
            ok: false,
            message: `type: element ${elementId} is not text-editable (tag=${meta.tag}, type=${meta.inputType || "-"})`
          };
        }

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
        const ms = this.resolveWaitDurationMs(args);
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

  private applyPageTimeouts(target: Page): void {
    target.setDefaultNavigationTimeout(this.config.navigationTimeoutMs);
    target.setDefaultTimeout(this.config.actionTimeoutMs);
  }

  private syncPageReference(): void {
    if (!this.context) {
      return;
    }

    const pages = this.context.pages().filter((item) => !item.isClosed());
    if (pages.length === 0) {
      return;
    }

    if (!this.page || this.page.isClosed()) {
      const replacement = pages.at(-1) ?? pages[0];
      if (!replacement) {
        return;
      }
      this.page = replacement;
      this.applyPageTimeouts(replacement);
      return;
    }

    if (this.config.adoptLatestPageOnNewTab) {
      const last = pages.at(-1);
      if (last && last !== this.page) {
        this.page = last;
        this.applyPageTimeouts(last);
      }
    }
  }

  private async openUrlWithTolerance(page: Page, url: string): Promise<string> {
    const beforeUrl = page.url();
    try {
      await page.goto(url, {
        waitUntil: this.config.navigationWaitUntil,
        timeout: this.config.navigationTimeoutMs
      });
      return `Opened ${url}`;
    } catch (error) {
      if (this.isNavigationTimeout(error) && page.url() !== beforeUrl) {
        return `Opened ${url} (partial load; timeout on ${this.config.navigationWaitUntil})`;
      }
      throw error;
    }
  }

  private async resolveHrefFromLocator(page: Page, locator: Locator): Promise<string | null> {
    const href = await locator.getAttribute("href").catch(() => null);
    if (!href) {
      return null;
    }

    try {
      return new URL(href, page.url()).toString();
    } catch {
      return null;
    }
  }

  private isTextEditableElement(meta: {
    tag: string;
    role: string;
    inputType: string;
    disabled: boolean;
    contentEditable: boolean;
  }): boolean {
    if (meta.disabled) {
      return false;
    }

    if (meta.contentEditable) {
      return true;
    }

    if (meta.tag === "textarea") {
      return true;
    }

    if (meta.tag === "input") {
      return this.config.typeActionAllowedInputTypes.includes(meta.inputType || "text");
    }

    return ["textbox", "searchbox", "combobox"].includes(meta.role);
  }

  private resolveWaitDurationMs(args: Record<string, unknown>): number {
    const rawMs = args.ms;
    if (typeof rawMs === "number" && Number.isFinite(rawMs)) {
      return Math.max(0, Math.round(rawMs));
    }

    const duration = args.duration;
    if (typeof duration === "number" && Number.isFinite(duration)) {
      const normalized = duration <= 60 ? duration * 1000 : duration;
      return Math.max(0, Math.round(normalized));
    }

    return this.config.waitAfterActionMs;
  }

  private isNavigationTimeout(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return error.message.toLowerCase().includes("timeout");
  }
}
