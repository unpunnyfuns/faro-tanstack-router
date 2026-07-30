import { render, waitFor } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetDependencies, setDependencies } from "./dependencies";
import { withFaroRouterInstrumentation } from "./withFaroRouterInstrumentation";

const pushEvent = vi.fn();
const fakeApi = { pushEvent, pushError: vi.fn() } as never;
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never;

function createTestRouter() {
  const rootRoute = createRootRoute();

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => null,
  });

  const postRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/posts/$postId",
    component: () => null,
  });

  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, postRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
}

describe("integration with @tanstack/react-router", () => {
  beforeEach(() => {
    resetDependencies();
    setDependencies(fakeApi, fakeLogger, {});
  });

  it("accepts a real router instance", () => {
    const router = createTestRouter();

    expect(withFaroRouterInstrumentation(router)).toBe(router);
  });

  it("emits route_change with the parameterised route pattern", async () => {
    const router = withFaroRouterInstrumentation(createTestRouter());

    render(createElement(RouterProvider, { router }));

    await waitFor(() => {
      expect(pushEvent).toHaveBeenCalled();
    });

    pushEvent.mockClear();

    await router.navigate({ to: "/posts/$postId", params: { postId: "42" } });

    await waitFor(() => {
      expect(pushEvent).toHaveBeenCalledWith(
        "route_change",
        expect.objectContaining({ toRoute: "/posts/$postId" }),
      );
    });
  });
});
