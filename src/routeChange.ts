import { EVENT_ROUTE_CHANGE, globalObject } from "@grafana/faro-web-sdk";
import type { API, EventAttributes } from "@grafana/faro-web-sdk";

import type { InstrumentableMatch, InstrumentableMatchStatus } from "./types";

export interface RouteTransition {
  fromRoute?: string;
  fromUrl?: string;
}

export interface RouteChangeInput {
  toRoute: string;
  status?: InstrumentableMatchStatus;
  previous: RouteTransition;
}

// Layout and pathless routes can carry an empty fullPath, which would be
// reported as an empty toRoute. Fall back to the concrete pathname instead.
export function resolveRoute(matches: InstrumentableMatch[], fallbackPathname: string): string {
  const leafRoute = matches.at(-1)?.fullPath;

  return leafRoute === undefined || leafRoute === "" ? fallbackPathname : leafRoute;
}

function currentUrl(): string {
  return globalObject.location?.href ?? "";
}

export function buildRouteChangeAttributes({
  toRoute,
  status,
  previous,
}: RouteChangeInput): EventAttributes {
  return {
    toRoute,
    toUrl: currentUrl(),
    ...(previous.fromRoute === undefined ? {} : { fromRoute: previous.fromRoute }),
    ...(previous.fromUrl === undefined ? {} : { fromUrl: previous.fromUrl }),
    ...(status === undefined || status === "success" ? {} : { toRouteStatus: status }),
  };
}

export function pushRouteChange(api: API, input: RouteChangeInput): RouteTransition {
  const attributes = buildRouteChangeAttributes(input);

  api.pushEvent(EVENT_ROUTE_CHANGE, attributes);

  return {
    fromRoute: attributes["toRoute"],
    fromUrl: attributes["toUrl"],
  };
}
