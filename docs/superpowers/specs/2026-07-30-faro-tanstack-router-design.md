# Faro instrumentation for TanStack Router — design

Date: 2026-07-30
Status: approved, ready for implementation planning

## Goal

Give TanStack Router users the routing telemetry that `@grafana/faro-react` provides for
React Router. Grafana tracks this as an open request in
[faro-web-sdk#777](https://github.com/grafana/faro-web-sdk/issues/777), unassigned since
January 2025.

The package is designed to be upstream-able: it follows Faro's conventions closely enough
that Grafana could adopt it, and a user switching from React Router changes only which
package their router wrapper comes from.

## Scope

In scope:

- `route_change` events on navigation, at parity with the React Router integration
- not-found and redirect state, as attributes on `route_change`
- loader and `beforeLoad` errors via `pushError`
- SPA and SSR (TanStack Start), from one code path

Out of scope, with reasons:

| Dropped | Reason |
| --- | --- |
| Navigation timing measurements | Requires state spanning multiple events, plus handling of interrupted navigations. `onRendered` is emitted by framework adapters rather than core, so depending on it narrows framework support. Novel measurement `type` no existing dashboard reads. |
| `api.setView()` from route | Faro's React integration deliberately does not do this. Changes the meaning of existing dashboards. |
| Error boundary, component profiler | `@grafana/faro-react` already provides these and they are router-agnostic. Nothing to add. |
| Source map upload | Handled by `@grafana/faro-webpack-plugin` / `@grafana/faro-rollup-plugin`. |

## Architecture

Two touchpoints, mirroring Faro's existing data-router setup:

1. `TanStackRouterInstrumentation` — a `BaseInstrumentation` registered in the
   `instrumentations` array. Captures `api` and `internalLogger` into module state during
   `initialize()`, and holds behavior options.
2. `withFaroRouterInstrumentation(router)` — wraps a router instance, subscribes to
   `onResolved`, returns the router unchanged.

### Why two touchpoints

Faro's data-router support already works this way. `withFaroRouterInstrumentation` cannot
reach `api` on its own, because `api` is only handed to an instrumentation by the Faro core
after `initializeFaro()` runs.

A single config touchpoint (`new TanStackRouterInstrumentation({ router })`) was rejected:
TanStack Start's convention is an exported `getRouter()` factory that the framework calls
per request, so no router instance exists at `initializeFaro()` time. Config-only would
force two different setup stories for SPA and SSR.

Reading the exported `faro` singleton instead of using dependency injection was also
rejected. It would allow a single touchpoint, but diverges from how every existing Faro
instrumentation is wired, which works against the upstream goal.

### Why target `router-core`

`subscribe()` and `emit()` live on the core `Router` class. The React, Solid, and Vue
adapters all share it. Instrumenting against `router-core`'s router interface supports all
three, and TanStack Start, with one implementation. Peer dependency is
`@tanstack/router-core` only.

### Module layout

| File | Responsibility |
| --- | --- |
| `src/instrumentation.ts` | `TanStackRouterInstrumentation` class |
| `src/dependencies.ts` | Module-level `api`, `internalLogger`, `isInitialized`, `setDependencies()` |
| `src/withFaroRouterInstrumentation.ts` | Router wrapper and subscription |
| `src/routeChange.ts` | Builds and pushes the `route_change` event |
| `src/routeErrors.ts` | Scans matches for failures, pushes errors, dedupes |
| `src/types.ts` | Structural router types, config types |
| `src/index.ts` | Public exports |

Each unit is independently testable: `routeChange.ts` and `routeErrors.ts` are pure
functions over a router state snapshot plus a Faro `API`, with no subscription logic.

## Public API

```ts
export class TanStackRouterInstrumentation extends BaseInstrumentation {
  constructor(options?: TanStackRouterInstrumentationOptions)
}

export interface TanStackRouterInstrumentationOptions {
  /** Report failed route matches via pushError. Default: true. */
  captureRouteErrors?: boolean
  /** Drop the event when this returns false. Receives the resolved route pattern. */
  shouldReportRoute?: (route: string) => boolean
}

export function withFaroRouterInstrumentation<TRouter extends InstrumentableRouter>(
  router: TRouter,
): TRouter
```

`InstrumentableRouter` is a structural type covering the parts of the router we read
(`subscribe`, `state`, `isServer`). We do not import TanStack types directly, so the package
does not need to track TanStack's type-level churn.

## Data flow

Subscription is to `onResolved`, which fires once a navigation has fully settled.

```
onResolved({ fromLocation, toLocation, hrefChanged })
  ├─ isInitialized === false          → return, warn once
  ├─ leaf     = router.state.matches.at(-1)
  ├─ toRoute  = leaf?.fullPath ?? toLocation.pathname
  ├─ shouldReportRoute(toRoute) === false → return
  │
  ├─ route_change branch
  │    ├─ hrefChanged === false       → skip
  │    ├─ index delta === 0 (REPLACE) → skip
  │    └─ pushEvent('route_change', { ... })
  │
  └─ error branch  (if captureRouteErrors)
       └─ scan router.state.matches for status === 'error' → pushError
```

The two branches are independent. A loader failure during a REPLACE navigation is still
reported, even though no `route_change` is emitted for it — navigation-type filtering is
about event noise, and has no bearing on whether an error occurred.

### `route_change`

Uses `EVENT_ROUTE_CHANGE` from `@grafana/faro-web-sdk` (the string `route_change`), so
existing Frontend Observability dashboards work unchanged.

| Attribute | Source | Notes |
| --- | --- | --- |
| `toRoute` | `matches.at(-1).fullPath` | Route pattern, e.g. `/posts/$postId` |
| `toUrl` | `globalObject.location?.href` | Matches Faro's React Router behavior |
| `fromRoute` | previous `toRoute` | Omitted on first navigation |
| `fromUrl` | previous `toUrl` | Omitted on first navigation |
| `toRouteStatus` | `matches.at(-1).status` | Only present when not `success` |

`fromRoute` / `fromUrl` are held in closure state on the wrapper, per router instance —
matching how `withFaroRouterInstrumentation.ts` in `@grafana/faro-react` tracks them via a
`lastRoute` local.

That state advances **only when an event is emitted**, never on a skipped REPLACE. A replace
almost always leaves the route pattern unchanged, so the next real navigation still reports
the correct `fromRoute`. The consequence is that `fromUrl` can lag behind the address bar by
the search parameters a replace changed; reporting the URL the user actually navigated *from*
is preferable to reporting one they never navigated to.

All values are strings. `EventAttributes` is `Record<string, string>`
(`core/src/api/events/types.ts:6`), so no numeric attributes are possible.

### Route errors

Scan `router.state.matches` for `status === 'error'` and push each via `pushError`.

This closes a genuine gap. TanStack's `errorComponent` catches loader failures itself, so
they never reach `FaroErrorBoundary` and are currently invisible to Faro.

Error classification comes from which field is populated, not from `isFetching`.
`isFetching` reports *current* state (`Matches.ts:135`) and reads `false` once a match has
settled into `status: 'error'`, so it cannot tell us which phase failed after the fact. The
error fields are distinct and survive:

| Context attribute | Source |
| --- | --- |
| `route` | `match.fullPath` |
| `url` | `globalObject.location?.href` |
| `errorSource` | `'params'` if `paramsError`, `'search'` if `searchError`, else `'load'` |
| `cause` | `match.cause` — `'preload' \| 'enter' \| 'stay'` |

`errorSource: 'load'` covers both `beforeLoad` and `loader` failures, which land in the same
`match.error` field and are genuinely indistinguishable from a settled match. We report the
distinction we can actually make rather than guessing at one we cannot.

`cause` is carried because `defaultPreload: 'intent'` makes hover-triggered loads common; a
`preload` error has different severity from an `enter` error and consumers should be able to
separate them.

Dedupe key is `` `${match.id}:${match.updatedAt}` `` held in a `Set` on the wrapper closure.
`onResolved` can fire more than once for the same failed match; the key changes only when
the match is genuinely re-run. The set is capped at 100 keys, evicting oldest first, so a
long-lived session with many failures cannot grow it without bound.

### Navigation type filtering

At parity with `FaroRoutes.tsx:23`, we report PUSH and POP navigations and skip REPLACE.

TanStack's `historyAction` is a local inside `load()` (`router.ts:2462`) and is not carried
on the emitted event, but the action is recoverable from data the event already holds.
`@tanstack/history` encodes it positionally in history state: `push` stores
`currentIndex + 1` (`history/src/index.ts:177`), `replace` stores `currentIndex` unchanged
(`index.ts:191`), and TanStack derives back/forward from the same delta (`index.ts:412`).
`ParsedLocation.state` is present on both `fromLocation` and `toLocation`, so:

```ts
const delta =
  toLocation.state.__TSR_index - (fromLocation?.state.__TSR_index ?? -1)
// delta !== 0 → PUSH / FORWARD / BACK — report
// delta === 0 → REPLACE — skip
```

No extra subscription, no correlation state.

**Redirects still produce an event.** TanStack applies every `throw redirect(...)` with
`replace: true` hardcoded (`router.ts:2605`), so a naive REPLACE filter would swallow
redirect destinations. It does not, because `resolvedLocation` advances only at
`onResolved` and therefore stays pinned to the pre-navigation location for the duration of
a redirect chain. A push to `/admin` that redirects to `/login` yields a single delta of
`+1` and one `route_change` landing on `/login` with the correct `fromRoute`. Multi-hop
chains collapse into one logical navigation, which is the desired behavior.

**What is intentionally dropped** is a standalone `navigate({ replace: true })` with no
preceding push: search parameter updates, canonicalization, and wizard-style step changes
implemented as replaces. TanStack treats typed search params as the idiomatic place to hold
UI state, so a debounced filter panel would otherwise emit a `route_change` per keystroke.
The React Router integration drops these too. To be documented in the README.

`hrefChanged` is checked as well, so pushing an identical href twice does not emit.

### Deliberate divergences from the React Router integration

**Silent drops become a warning.** `withFaroRouterInstrumentation.ts:40` in
`@grafana/faro-react` guards on `isInitialized` and discards events with no signal. Ours
emits a `console.warn` the first time an event is dropped for that reason, naming the likely
cause: the instrumentation was not registered in `initializeFaro`. The warning fires at most
once per module instance, not once per router, so wrapping several routers cannot produce a
stream of warnings.

## SSR

`withFaroRouterInstrumentation` returns the router untouched when `router.isServer` is true.
That property is public on the router instance (`router.ts:1018`) and defaults to
`typeof document === 'undefined'`, so it respects an explicit `isServer` option when the
user sets one.

This is the entire SSR story. `getRouter()` runs per request on the server; we subscribe
only on the client, during hydration. Hydration itself resolves the initial route and fires
`onResolved`, so the initial route is captured once, on the client, without a double-fire.

The package must not touch `window`, `document`, or `location` at module scope so it can be
imported into a server bundle. Runtime access to `location` goes through Faro's
`globalObject`.

## Error handling

| Condition | Behavior |
| --- | --- |
| Instrumentation not registered | No events. One `console.warn` on first drop. |
| `router.state.matches` empty | Fall back to `toLocation.pathname` for `toRoute`. |
| `match.error` is not an `Error` | Wrap in an `Error` with the stringified value as message. |
| `shouldReportRoute` throws | Catch, log via `internalLogger`, report the route. |
| Wrapper called twice on one router | Second call is a no-op. Marked with a symbol on the router. |

## Testing

Vitest. The subscription surface is small enough to test against a fake router rather than a
real TanStack instance: an object with `subscribe`, `state`, and `isServer` that lets tests
drive `onResolved` directly. Faro's `api` is mocked, following the shape of
`packages/react/src/router/__matrix__/faroApiMock.ts` upstream.

Cases:

- emits `route_change` with the route pattern, not the concrete URL
- omits `fromRoute` / `fromUrl` on first navigation, populates on second
- returns early when `hrefChanged` is false
- emits when the history index delta is `+1` (push) and `-1` (back)
- skips when the history index delta is `0` (replace)
- emits on initial page load, where `fromLocation` is undefined
- emits exactly one event for a push-then-redirect chain, with the `fromRoute` of the
  location that preceded the push
- falls back to `pathname` when matches are empty
- sets `toRouteStatus` for `notFound` and `redirected`, omits it for `success`
- pushes one error per failed match, and not again on a repeat `onResolved`
- pushes a new error when the same match fails again with a later `updatedAt`
- reports a loader error on a REPLACE navigation, even though no `route_change` is emitted
- classifies `errorSource` as `params`, `search`, and `load` from the respective fields
- does not subscribe when `router.isServer` is true
- drops events and warns once when the instrumentation was never registered
- honors `shouldReportRoute` and `captureRouteErrors: false`

An integration test against a real `@tanstack/react-router` instance covers one happy-path
navigation, guarding against drift in the structural types.

## Tooling

oxlint and oxfmt. Vitest. Built for both ESM and CJS with type declarations, matching how
Faro packages are consumed. Peer dependencies: `@tanstack/router-core` and
`@grafana/faro-web-sdk`.

## Open decisions

Package name. `faro-tanstack-router` is the working name and reads correctly for a
third-party package. If upstreamed it would become `@grafana/faro-tanstack-router`.
Resolve before publishing; it does not block implementation.
