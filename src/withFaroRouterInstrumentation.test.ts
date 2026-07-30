import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDependencies, setDependencies } from "./dependencies";
import type { InstrumentableMatch, InstrumentableRouter, NavigationEvent } from "./types";
import { withFaroRouterInstrumentation } from "./withFaroRouterInstrumentation";

const pushEvent = vi.fn();
const pushError = vi.fn();
const fakeApi = { pushEvent, pushError } as never;
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never;

function match(overrides: Partial<InstrumentableMatch> = {}): InstrumentableMatch {
  return {
    id: "match-1",
    fullPath: "/posts/$postId",
    status: "success",
    updatedAt: 1,
    ...overrides,
  };
}

type FakeRouter = InstrumentableRouter & {
  emit: (event: NavigationEvent) => void;
  setMatches: (next: InstrumentableMatch[]) => void;
};

function createFakeRouter(matches: InstrumentableMatch[] = [match()]): FakeRouter {
  const listeners: Array<(event: NavigationEvent) => void> = [];

  const router: FakeRouter = {
    isServer: false,
    state: { matches },
    subscribe: (_eventType, fn) => {
      listeners.push(fn);

      return () => {
        listeners.splice(listeners.indexOf(fn), 1);
      };
    },
    emit: (event) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
    setMatches: (next) => {
      router.state.matches = next;
    },
  };

  return router;
}

function navigation(toIndex: number, fromIndex?: number, pathname = "/posts/42"): NavigationEvent {
  return {
    toLocation: {
      href: `https://example.test${pathname}`,
      pathname,
      state: { __TSR_index: toIndex },
    },
    fromLocation:
      fromIndex === undefined
        ? undefined
        : {
            href: "https://example.test/posts",
            pathname: "/posts",
            state: { __TSR_index: fromIndex },
          },
    hrefChanged: true,
  };
}

describe("withFaroRouterInstrumentation", () => {
  beforeEach(() => {
    resetDependencies();
    window.history.replaceState({}, "", "/posts/42");
  });

  it("returns the same router instance", () => {
    const router = createFakeRouter();

    expect(withFaroRouterInstrumentation(router)).toBe(router);
  });

  it("does not subscribe on the server", () => {
    const router = createFakeRouter();
    router.isServer = true;
    const subscribe = vi.spyOn(router, "subscribe");

    withFaroRouterInstrumentation(router);

    expect(subscribe).not.toHaveBeenCalled();
  });

  it("subscribes only once when wrapped twice", () => {
    const router = createFakeRouter();
    const subscribe = vi.spyOn(router, "subscribe");

    withFaroRouterInstrumentation(router);
    withFaroRouterInstrumentation(router);

    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it("drops events and warns once when never initialised", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const router = withFaroRouterInstrumentation(createFakeRouter());

    router.emit(navigation(1, 0));
    router.emit(navigation(2, 1));

    expect(pushEvent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("emits route_change with the route pattern", () => {
    setDependencies(fakeApi, fakeLogger, {});
    const router = withFaroRouterInstrumentation(createFakeRouter());

    router.emit(navigation(1, 0));

    expect(pushEvent).toHaveBeenCalledWith(
      "route_change",
      expect.objectContaining({ toRoute: "/posts/$postId" }),
    );
  });

  it("carries the previous route into the next navigation", () => {
    setDependencies(fakeApi, fakeLogger, {});
    const router = withFaroRouterInstrumentation(createFakeRouter());

    router.emit(navigation(1, 0));
    router.setMatches([match({ fullPath: "/users" })]);
    router.emit(navigation(2, 1));

    expect(pushEvent.mock.calls[1]?.[1]).toMatchObject({
      toRoute: "/users",
      fromRoute: "/posts/$postId",
    });
  });

  it("skips replace navigations", () => {
    setDependencies(fakeApi, fakeLogger, {});
    const router = withFaroRouterInstrumentation(createFakeRouter());

    router.emit(navigation(3, 3));

    expect(pushEvent).not.toHaveBeenCalled();
  });

  it("skips navigations where the href did not change", () => {
    setDependencies(fakeApi, fakeLogger, {});
    const router = withFaroRouterInstrumentation(createFakeRouter());

    router.emit({ ...navigation(1, 0), hrefChanged: false });

    expect(pushEvent).not.toHaveBeenCalled();
  });

  it("reports route errors even on a replace navigation", () => {
    setDependencies(fakeApi, fakeLogger, {});
    const router = withFaroRouterInstrumentation(
      createFakeRouter([match({ status: "error", error: new Error("boom") })]),
    );

    router.emit(navigation(3, 3));

    expect(pushEvent).not.toHaveBeenCalled();
    expect(pushError).toHaveBeenCalledTimes(1);
  });

  it("honours captureRouteErrors: false", () => {
    setDependencies(fakeApi, fakeLogger, { captureRouteErrors: false });
    const router = withFaroRouterInstrumentation(
      createFakeRouter([match({ status: "error", error: new Error("boom") })]),
    );

    router.emit(navigation(1, 0));

    expect(pushError).not.toHaveBeenCalled();
  });

  it("honours shouldReportRoute", () => {
    setDependencies(fakeApi, fakeLogger, {
      shouldReportRoute: (route) => route !== "/posts/$postId",
    });
    const router = withFaroRouterInstrumentation(createFakeRouter());

    router.emit(navigation(1, 0));

    expect(pushEvent).not.toHaveBeenCalled();
  });

  it("reports the route when shouldReportRoute throws", () => {
    setDependencies(fakeApi, fakeLogger, {
      shouldReportRoute: () => {
        throw new Error("predicate blew up");
      },
    });
    const router = withFaroRouterInstrumentation(createFakeRouter());

    router.emit(navigation(1, 0));

    expect(pushEvent).toHaveBeenCalledTimes(1);
  });

  it("falls back to the pathname when there are no matches", () => {
    setDependencies(fakeApi, fakeLogger, {});
    const router = withFaroRouterInstrumentation(createFakeRouter([]));

    router.emit(navigation(1, 0));

    expect(pushEvent).toHaveBeenCalledWith(
      "route_change",
      expect.objectContaining({ toRoute: "/posts/42" }),
    );
  });
});
