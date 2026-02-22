import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_RUNTIME,
  HEALTH_PATH,
  POLL_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  STORAGE_KEY,
} from "../constants";
import type { HealthState } from "../types";
import { normalizeRuntimeUrl } from "../utils";

type RuntimeHealthState = {
  inputValue: string;
  healthState: HealthState;
  lastCheckedAt: Date | null;
  setInputValue: (next: string) => void;
  commitRuntimeUrl: () => void;
};

export function useRuntimeHealth(): RuntimeHealthState {
  const [inputValue, setInputValue] = useState<string>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ?? DEFAULT_RUNTIME;
  });
  const [runtimeOrigin, setRuntimeOrigin] = useState<string | null>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY) ?? DEFAULT_RUNTIME;
    return normalizeRuntimeUrl(saved) ?? DEFAULT_RUNTIME;
  });
  const [healthState, setHealthState] = useState<HealthState>("unreachable");
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);

  const commitRuntimeUrl = useCallback(() => {
    const normalized = normalizeRuntimeUrl(inputValue);
    if (!normalized) {
      setRuntimeOrigin(null);
      setHealthState("invalid");
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    setInputValue(normalized);
    setRuntimeOrigin(normalized);
    window.localStorage.setItem(STORAGE_KEY, normalized);
  }, [inputValue]);

  useEffect(() => {
    if (!runtimeOrigin) {
      setHealthState("invalid");
      return;
    }

    let cancelled = false;

    const check = async (): Promise<void> => {
      if (!runtimeOrigin) {
        return;
      }

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => {
        controller.abort();
      }, REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(`${runtimeOrigin}${HEALTH_PATH}`, {
          method: "GET",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Health endpoint returned non-OK");
        }

        const payload = (await response.json()) as { status?: string };
        if (!cancelled) {
          setHealthState(payload.status === "ok" ? "healthy" : "unreachable");
          setLastCheckedAt(new Date());
        }
      } catch {
        if (!cancelled) {
          setHealthState("unreachable");
          setLastCheckedAt(new Date());
        }
      } finally {
        clearTimeout(timeoutId);
      }
    };

    void check();
    const intervalId = window.setInterval(() => {
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [runtimeOrigin]);

  return {
    inputValue,
    healthState,
    lastCheckedAt,
    setInputValue,
    commitRuntimeUrl,
  };
}
