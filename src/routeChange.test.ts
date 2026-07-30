import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildRouteChangeAttributes, pushRouteChange, resolveRoute } from "./routeChange";
import type { InstrumentableMatch } from "./types";

function match(overrides: Partial<InstrumentableMatch>): InstrumentableMatch {
  return {
    id: "match-1",
    fullPath: "/posts",
    status: "success",
    updatedAt: 1,
    ...overrides,
  };
}

describe("resolveRoute", () => {
  it("returns the leaf match route pattern", () => {
    const matches = [
      match({ id: "a", fullPath: "/posts" }),
      match({ id: "b", fullPath: "/posts/$postId" }),
    ];

    expect(resolveRoute(matches, "/posts/42")).toBe("/posts/$postId");
  });

  it("falls back to the pathname when there are no matches", () => {
    expect(resolveRoute([], "/posts/42")).toBe("/posts/42");
  });

  it("falls back to the pathname when the leaf match has no route pattern", () => {
    expect(resolveRoute([match({ fullPath: "" })], "/posts/42")).toBe("/posts/42");
  });
});

describe("buildRouteChangeAttributes", () => {
  it("omits fromRoute and fromUrl on the first navigation", () => {
    const attributes = buildRouteChangeAttributes({
      toRoute: "/posts",
      previous: {},
    });

    expect(attributes).toEqual({
      toRoute: "/posts",
      toUrl: expect.any(String),
    });
  });

  it("includes the previous route and url on later navigations", () => {
    const attributes = buildRouteChangeAttributes({
      toRoute: "/posts/$postId",
      previous: { fromRoute: "/posts", fromUrl: "https://example.test/posts" },
    });

    expect(attributes["fromRoute"]).toBe("/posts");
    expect(attributes["fromUrl"]).toBe("https://example.test/posts");
  });

  it("adds toRouteStatus only when the status is not success", () => {
    expect(
      buildRouteChangeAttributes({
        toRoute: "/missing",
        status: "notFound",
        previous: {},
      })["toRouteStatus"],
    ).toBe("notFound");

    expect(
      buildRouteChangeAttributes({
        toRoute: "/posts",
        status: "success",
        previous: {},
      })["toRouteStatus"],
    ).toBeUndefined();
  });

  it("reads the current url from the browser location", () => {
    window.history.replaceState({}, "", "/posts/42");

    expect(
      buildRouteChangeAttributes({ toRoute: "/posts/$postId", previous: {} })["toUrl"],
    ).toContain("/posts/42");
  });
});

describe("pushRouteChange", () => {
  const pushEvent = vi.fn();
  const api = { pushEvent } as never;

  beforeEach(() => {
    window.history.replaceState({}, "", "/posts");
  });

  it("pushes a route_change event", () => {
    pushRouteChange(api, { toRoute: "/posts", previous: {} });

    expect(pushEvent).toHaveBeenCalledWith(
      "route_change",
      expect.objectContaining({ toRoute: "/posts" }),
    );
  });

  it("returns the transition to use as the next fromRoute", () => {
    const next = pushRouteChange(api, { toRoute: "/posts", previous: {} });

    expect(next.fromRoute).toBe("/posts");
    expect(next.fromUrl).toContain("/posts");
  });
});
