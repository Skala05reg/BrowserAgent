import { BrowserActionLimitsConfig } from "../config/types.js";

export interface NavigationPolicyResult {
  ok: boolean;
  url: string | null;
  reason: string;
}

const IPV4_PATTERN = /^(\d{1,3})(?:\.(\d{1,3})){3}$/;

function isPrivateIPv4(hostname: string): boolean {
  if (!IPV4_PATTERN.test(hostname)) {
    return false;
  }

  const octets = hostname.split(".").map((item) => Number(item));
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }

  const first = octets[0] ?? 0;
  const second = octets[1] ?? 0;

  if (first === 10) {
    return true;
  }

  if (first === 127) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  return false;
}

function isPrivateIPv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "::1") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  return false;
}

function matchesBlockedHostPattern(hostname: string, pattern: string): boolean {
  const normalizedPattern = pattern.trim().toLowerCase();
  if (!normalizedPattern) {
    return false;
  }

  if (hostname === normalizedPattern) {
    return true;
  }

  return hostname.endsWith(`.${normalizedPattern}`);
}

export function resolveSafeNavigationUrl(
  rawUrl: string,
  baseUrl: string,
  limits: BrowserActionLimitsConfig
): NavigationPolicyResult {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl, baseUrl);
  } catch {
    return { ok: false, url: null, reason: "invalid URL" };
  }

  if (!limits.allowedNavigationProtocols.includes(parsed.protocol)) {
    return {
      ok: false,
      url: null,
      reason: `unsupported protocol "${parsed.protocol}"`
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { ok: false, url: null, reason: "missing hostname" };
  }

  if (limits.blockedHostPatterns.some((pattern) => matchesBlockedHostPattern(hostname, pattern))) {
    return { ok: false, url: null, reason: `blocked host "${hostname}"` };
  }

  if (!limits.allowPrivateNetworkHosts) {
    if (hostname === "localhost" || hostname.endsWith(".local")) {
      return { ok: false, url: null, reason: `private host "${hostname}"` };
    }
    if (isPrivateIPv4(hostname) || isPrivateIPv6(hostname)) {
      return { ok: false, url: null, reason: `private IP host "${hostname}"` };
    }
  }

  return { ok: true, url: parsed.toString(), reason: "ok" };
}
