import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dependencies from "./dependencies";
import { resetDependencies } from "./dependencies";
import { TanStackRouterInstrumentation } from "./instrumentation";
import type { TanStackRouterInstrumentationOptions } from "./types";
import { VERSION } from "./version";

const fakeApi = { pushEvent: vi.fn(), pushError: vi.fn() } as never;
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never;

function reportEveryRoute(): boolean {
  return true;
}

function initialise(options?: TanStackRouterInstrumentationOptions) {
  const instrumentation = new TanStackRouterInstrumentation(options);

  instrumentation.api = fakeApi;
  instrumentation.internalLogger = fakeLogger;
  instrumentation.initialize();

  return instrumentation;
}

describe("TanStackRouterInstrumentation", () => {
  beforeEach(() => {
    resetDependencies();
  });

  it("identifies itself", () => {
    const instrumentation = new TanStackRouterInstrumentation();

    expect(instrumentation.name).toBe("@unpunnyfuns/faro-tanstack-router");
    expect(instrumentation.version).toBe(VERSION);
  });

  it("publishes the Faro api and logger on initialize", () => {
    initialise();

    expect(dependencies.isInitialized).toBe(true);
    expect(dependencies.api).toBe(fakeApi);
    expect(dependencies.internalLogger).toBe(fakeLogger);
  });

  it("publishes the options it was constructed with", () => {
    initialise({ captureRouteErrors: false, shouldReportRoute: reportEveryRoute });

    expect(dependencies.options.captureRouteErrors).toBe(false);
    expect(dependencies.options.shouldReportRoute).toBe(reportEveryRoute);
  });

  it("defaults to an empty options object", () => {
    initialise();

    expect(dependencies.options).toEqual({});
  });
});
