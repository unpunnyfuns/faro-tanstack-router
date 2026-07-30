import type { API, InternalLogger } from "@grafana/faro-web-sdk";

import type { TanStackRouterInstrumentationOptions } from "./types";

export let api: API | undefined;
export let internalLogger: InternalLogger | undefined;
export let options: TanStackRouterInstrumentationOptions = {};
export let isInitialized = false;

let hasWarnedNotInitialized = false;

export function setDependencies(
  newApi: API,
  newInternalLogger: InternalLogger,
  newOptions: TanStackRouterInstrumentationOptions,
): void {
  api = newApi;
  internalLogger = newInternalLogger;
  options = newOptions;
  isInitialized = true;
}

export function warnNotInitialized(): void {
  if (hasWarnedNotInitialized) {
    return;
  }

  hasWarnedNotInitialized = true;

  console.warn(
    "[faro-tanstack-router] Dropping router events: TanStackRouterInstrumentation was not registered. Add it to the instrumentations array passed to initializeFaro().",
  );
}

// Test-only. Resets module state between cases.
export function resetDependencies(): void {
  api = undefined;
  internalLogger = undefined;
  options = {};
  isInitialized = false;
  hasWarnedNotInitialized = false;
}
