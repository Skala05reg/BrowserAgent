import { describe, expect, it } from "vitest";
import { BrowserActionLimitsConfig } from "../../src/config/types.js";
import { resolveSafeNavigationUrl } from "../../src/browser/navigationPolicy.js";

function createLimits(overrides: Partial<BrowserActionLimitsConfig> = {}): BrowserActionLimitsConfig {
  return {
    maxTypeTextLength: 1200,
    maxScrollAmountPx: 3000,
    maxWaitMs: 30_000,
    allowedNavigationProtocols: ["http:", "https:"],
    blockedHostPatterns: ["localhost", "metadata.google.internal"],
    allowPrivateNetworkHosts: false,
    ...overrides
  };
}

describe("resolveSafeNavigationUrl", () => {
  it("allows relative urls for allowed protocols", () => {
    const result = resolveSafeNavigationUrl("/docs", "https://example.com/start", createLimits());

    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://example.com/docs");
  });

  it("blocks unsupported protocols", () => {
    const result = resolveSafeNavigationUrl("javascript:alert(1)", "https://example.com", createLimits());

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("unsupported protocol");
  });

  it("blocks hosts by pattern and private networks", () => {
    const blockedByPattern = resolveSafeNavigationUrl("https://metadata.google.internal/path", "https://example.com", createLimits());
    const blockedPrivateIp = resolveSafeNavigationUrl("http://192.168.0.10", "https://example.com", createLimits());

    expect(blockedByPattern.ok).toBe(false);
    expect(blockedByPattern.reason).toContain("blocked host");
    expect(blockedPrivateIp.ok).toBe(false);
    expect(blockedPrivateIp.reason).toContain("private IP host");
  });

  it("allows private hosts when explicitly enabled", () => {
    const result = resolveSafeNavigationUrl(
      "http://192.168.0.10",
      "https://example.com",
      createLimits({ allowPrivateNetworkHosts: true, blockedHostPatterns: [] })
    );

    expect(result.ok).toBe(true);
    expect(result.url).toBe("http://192.168.0.10/");
  });
});
