import type { HealthState } from "./types";

export function normalizeRuntimeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.hostname) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function formatStatus(state: HealthState): string {
  switch (state) {
    case "healthy":
      return "Healthy";
    case "unreachable":
      return "Unreachable";
    case "invalid":
      return "Invalid URL";
  }
  return "Unreachable";
}
