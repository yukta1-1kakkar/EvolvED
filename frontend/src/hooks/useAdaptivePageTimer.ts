import { useEffect, useRef } from "react";

import { recordAdaptivePageTiming } from "@/lib/api/progress";

const timingQueues = new Map<string, Promise<unknown>>();

function enqueueTiming(input: Parameters<typeof recordAdaptivePageTiming>[0]) {
  const queueKey = `${input.learnerId}:${input.sessionId}`;
  const pending = timingQueues.get(queueKey) ?? Promise.resolve();
  const next = pending
    .catch(() => undefined)
    .then(() => recordAdaptivePageTiming(input));
  timingQueues.set(queueKey, next);
  void next.then(() => {
    if (timingQueues.get(queueKey) === next) timingQueues.delete(queueKey);
  }, () => {
    if (timingQueues.get(queueKey) === next) timingQueues.delete(queueKey);
  });
  return next;
}

export function useAdaptivePageTimer({
  learnerId,
  sessionId,
  pageKey,
  pageTitle,
  pageKind,
  enabled = true,
}: {
  learnerId: string;
  sessionId: string;
  pageKey: string;
  pageTitle: string;
  pageKind: "lesson" | "assessment";
  enabled?: boolean;
}) {
  const startedAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !learnerId || !sessionId || !pageKey || typeof window === "undefined") return;
    startedAtRef.current = performance.now();

    function flush() {
      if (!startedAtRef.current) return;
      const now = performance.now();
      const secondsSpent = (now - startedAtRef.current) / 1000;
      startedAtRef.current = now;
      if (secondsSpent < 0.25) return;
      void enqueueTiming({ learnerId, sessionId, pageKey, pageTitle, pageKind, secondsSpent }).catch((error) => {
        console.error("Could not record adaptive page timing", error);
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") flush();
      else startedAtRef.current = performance.now();
    }

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      flush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, learnerId, pageKey, pageKind, pageTitle, sessionId]);
}
