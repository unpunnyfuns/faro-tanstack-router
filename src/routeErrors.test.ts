import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRouteErrorReporter, getErrorSource, toError } from "./routeErrors";
import type { InstrumentableMatch } from "./types";

function match(overrides: Partial<InstrumentableMatch>): InstrumentableMatch {
  return {
    id: "match-1",
    fullPath: "/posts/$postId",
    status: "error",
    updatedAt: 1,
    cause: "enter",
    ...overrides,
  };
}

describe("getErrorSource", () => {
  it("reports params errors", () => {
    expect(getErrorSource(match({ paramsError: new Error("bad param") }))).toBe("params");
  });

  it("reports search errors", () => {
    expect(getErrorSource(match({ searchError: new Error("bad search") }))).toBe("search");
  });

  it("reports everything else as a load error", () => {
    expect(getErrorSource(match({ error: new Error("loader blew up") }))).toBe("load");
  });
});

describe("toError", () => {
  it("passes an Error through unchanged", () => {
    const err = new Error("boom");

    expect(toError(err)).toBe(err);
  });

  it("wraps a non-Error value", () => {
    expect(toError("boom")).toBeInstanceOf(Error);
    expect(toError("boom").message).toBe("boom");
  });
});

describe("createRouteErrorReporter", () => {
  const pushError = vi.fn();
  const api = { pushError } as never;

  beforeEach(() => {
    window.history.replaceState({}, "", "/posts/42");
  });

  it("ignores matches that did not error", () => {
    createRouteErrorReporter()(api, [match({ status: "success" })]);

    expect(pushError).not.toHaveBeenCalled();
  });

  it("pushes one error per failed match with route context", () => {
    createRouteErrorReporter()(api, [match({ error: new Error("loader blew up") })]);

    expect(pushError).toHaveBeenCalledTimes(1);
    expect(pushError.mock.calls[0]?.[1]).toEqual({
      type: "TanStackRouterError",
      context: {
        route: "/posts/$postId",
        url: expect.stringContaining("/posts/42"),
        errorSource: "load",
        cause: "enter",
      },
    });
  });

  it("describes the route when a failed match carries no error value", () => {
    createRouteErrorReporter()(api, [match({ status: "error" })]);

    expect(pushError).toHaveBeenCalledTimes(1);
    expect(pushError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(pushError.mock.calls[0]?.[0].message).toBe(
      "Route /posts/$postId failed without an error value",
    );
  });

  it("does not report the same match twice", () => {
    const report = createRouteErrorReporter();
    const matches = [match({ error: new Error("loader blew up") })];

    report(api, matches);
    report(api, matches);

    expect(pushError).toHaveBeenCalledTimes(1);
  });

  it("reports again when the match is re-run", () => {
    const report = createRouteErrorReporter();

    report(api, [match({ error: new Error("first"), updatedAt: 1 })]);
    report(api, [match({ error: new Error("second"), updatedAt: 2 })]);

    expect(pushError).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest key once the cap is reached", () => {
    const report = createRouteErrorReporter(2);

    report(api, [match({ id: "a", error: new Error("a") })]);
    report(api, [match({ id: "b", error: new Error("b") })]);
    report(api, [match({ id: "c", error: new Error("c") })]);
    report(api, [match({ id: "a", error: new Error("a") })]);

    expect(pushError).toHaveBeenCalledTimes(4);
  });
});
