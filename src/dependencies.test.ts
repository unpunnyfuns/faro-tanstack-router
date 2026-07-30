import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dependencies from "./dependencies";
import {
  isInitialized,
  options,
  resetDependencies,
  setDependencies,
  warnNotInitialized,
} from "./dependencies";

const fakeApi = { pushEvent: vi.fn(), pushError: vi.fn() } as never;
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never;

describe("dependencies", () => {
  beforeEach(() => {
    resetDependencies();
  });

  it("starts uninitialised", () => {
    expect(isInitialized).toBe(false);
    expect(dependencies.api).toBeUndefined();
  });

  it("records the api, logger and options once set", () => {
    setDependencies(fakeApi, fakeLogger, { captureRouteErrors: false });

    expect(dependencies.isInitialized).toBe(true);
    expect(dependencies.api).toBe(fakeApi);
    expect(dependencies.internalLogger).toBe(fakeLogger);
    expect(dependencies.options.captureRouteErrors).toBe(false);
  });

  it("warns at most once when never initialised", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    warnNotInitialized();
    warnNotInitialized();
    warnNotInitialized();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("faro-tanstack-router");
  });

  it("defaults options to an empty object", () => {
    expect(options).toEqual({});
  });
});
