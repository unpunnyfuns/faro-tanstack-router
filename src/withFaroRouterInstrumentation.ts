import * as dependencies from "./dependencies";
import { warnNotInitialized } from "./dependencies";
import { isReplaceNavigation } from "./navigation";
import { pushRouteChange, resolveRoute } from "./routeChange";
import type { RouteTransition } from "./routeChange";
import { createRouteErrorReporter } from "./routeErrors";
import type { InstrumentableRouter } from "./types";

const instrumentedRouters = new WeakSet<object>();

function shouldReportRoute(route: string): boolean {
  const predicate = dependencies.options.shouldReportRoute;

  if (predicate === undefined) {
    return true;
  }

  try {
    return predicate(route);
  } catch (err) {
    dependencies.internalLogger?.error(
      "[@unpunnyfuns/faro-tanstack-router] shouldReportRoute threw, reporting the route anyway",
      err,
    );

    return true;
  }
}

export function withFaroRouterInstrumentation<TRouter extends InstrumentableRouter>(
  router: TRouter,
): TRouter {
  if (router.isServer || instrumentedRouters.has(router)) {
    return router;
  }

  instrumentedRouters.add(router);

  let previous: RouteTransition = {};
  const reportRouteErrors = createRouteErrorReporter();

  router.subscribe("onResolved", (event) => {
    const api = dependencies.api;

    if (!dependencies.isInitialized || api === undefined) {
      warnNotInitialized();
      return;
    }

    const matches = router.state.matches;
    const toRoute = resolveRoute(matches, event.toLocation.pathname);

    if (!shouldReportRoute(toRoute)) {
      return;
    }

    if (event.hrefChanged && !isReplaceNavigation(event)) {
      previous = pushRouteChange(api, {
        toRoute,
        status: matches.at(-1)?.status,
        previous,
      });
    }

    if (dependencies.options.captureRouteErrors !== false) {
      reportRouteErrors(api, matches);
    }
  });

  return router;
}
