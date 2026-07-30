import { globalObject } from "@grafana/faro-web-sdk";
import type { API } from "@grafana/faro-web-sdk";

import type { InstrumentableMatch } from "./types";

const DEFAULT_MAX_SEEN_KEYS = 100;

export type RouteErrorReporter = (api: API, matches: InstrumentableMatch[]) => void;

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function getErrorSource(match: InstrumentableMatch): "params" | "search" | "load" {
  if (isPresent(match.paramsError)) {
    return "params";
  }

  if (isPresent(match.searchError)) {
    return "search";
  }

  return "load";
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function firstPresent(...values: unknown[]): unknown {
  return values.find(isPresent);
}

// Precedence matches getErrorSource, so the reported value always describes
// the same failure the errorSource context labels. A match can also settle
// into an error status with none of the three fields populated; reporting
// String(undefined) would send Faro an exception whose message is the
// literal text "undefined".
function toRouteError(match: InstrumentableMatch): Error {
  const value = firstPresent(match.paramsError, match.searchError, match.error);

  if (value === undefined) {
    return new Error(`Route ${match.fullPath} failed without an error value`);
  }

  return toError(value);
}

export function createRouteErrorReporter(
  maxSeenKeys: number = DEFAULT_MAX_SEEN_KEYS,
): RouteErrorReporter {
  const seen = new Set<string>();

  function remember(key: string): void {
    seen.add(key);

    if (seen.size > maxSeenKeys) {
      const oldest = seen.values().next().value;

      if (oldest !== undefined) {
        seen.delete(oldest);
      }
    }
  }

  return (api, matches) => {
    for (const match of matches) {
      if (match.status !== "error") {
        continue;
      }

      const key = `${match.id}:${match.updatedAt}`;

      if (seen.has(key)) {
        continue;
      }

      remember(key);

      api.pushError(toRouteError(match), {
        type: "TanStackRouterError",
        context: {
          route: match.fullPath,
          url: globalObject.location?.href ?? "",
          errorSource: getErrorSource(match),
          ...(match.cause === undefined ? {} : { cause: match.cause }),
        },
      });
    }
  };
}
