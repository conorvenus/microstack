import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  DEFAULT_RUNTIME,
  POLL_INTERVAL_MS,
  STORAGE_KEY,
} from "../constants";
import type { HealthState } from "../types";
import { normalizeRuntimeUrl } from "../utils";
import { getRuntimeHealth } from "@/features/runtime/api";

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

  const healthQuery = useQuery({
    queryKey: ["runtime-health", runtimeOrigin],
    queryFn: ({ signal }) => {
      if (!runtimeOrigin) {
        throw new Error("Missing runtime origin");
      }
      return getRuntimeHealth(runtimeOrigin, signal);
    },
    enabled: runtimeOrigin !== null,
    refetchInterval: POLL_INTERVAL_MS,
  });

  useEffect(() => {
    if (!runtimeOrigin) {
      setHealthState("invalid");
      setLastCheckedAt(null);
      return;
    }

    if (!healthQuery.data) {
      return;
    }

    setHealthState(healthQuery.data.healthState);
    setLastCheckedAt(healthQuery.data.checkedAt);
  }, [healthQuery.data, runtimeOrigin]);

  return {
    inputValue,
    healthState,
    lastCheckedAt,
    setInputValue,
    commitRuntimeUrl,
  };
}
