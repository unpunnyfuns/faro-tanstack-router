# faro-tanstack-router

Grafana Faro instrumentation for TanStack Router. Emits `route_change` events and reports
failed route matches, for SPA and SSR.

## Exports

| Export | Type | Purpose |
| --- | --- | --- |
| `TanStackRouterInstrumentation` | class | Register in `initializeFaro` to supply Faro's api and hold options |
| `withFaroRouterInstrumentation` | function | Wrap a router instance to subscribe to navigation |
| `TanStackRouterInstrumentationOptions` | type | `captureRouteErrors`, `shouldReportRoute` |

## Install

```bash
pnpm add faro-tanstack-router @grafana/faro-web-sdk
```

## SPA

```tsx
import { getWebInstrumentations, initializeFaro } from "@grafana/faro-web-sdk";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import {
  TanStackRouterInstrumentation,
  withFaroRouterInstrumentation,
} from "faro-tanstack-router";

import { routeTree } from "./routeTree.gen";

initializeFaro({
  url: "https://faro-collector.example.net/collect/<key>",
  app: { name: "my-app", version: "1.0.0" },
  instrumentations: [...getWebInstrumentations(), new TanStackRouterInstrumentation()],
});

const router = withFaroRouterInstrumentation(createRouter({ routeTree }));

export function App() {
  return <RouterProvider router={router} />;
}
```

## TanStack Start

```tsx
import { createRouter } from "@tanstack/react-router";
import { withFaroRouterInstrumentation } from "faro-tanstack-router";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return withFaroRouterInstrumentation(createRouter({ routeTree }));
}
```

`getRouter` runs on the server too. The wrapper returns the router untouched when
`router.isServer` is true, so no subscription and no telemetry happen server-side.

## Why two touchpoints

`withFaroRouterInstrumentation` cannot reach Faro's api on its own — Faro hands that to an
instrumentation only after `initializeFaro()` has run. Registering the instrumentation is
what supplies it. This mirrors how `@grafana/faro-react` sets up its data router.

Passing the router into the instrumentation config instead would not work for TanStack
Start, whose convention is an exported `getRouter()` factory the framework calls per
request. No router instance exists at `initializeFaro()` time, so config-only would mean two
different setup stories for SPA and SSR. Wrapping the router keeps them the same.

The two calls are order-independent.

## Options

```ts
new TanStackRouterInstrumentation({
  captureRouteErrors: true,
  shouldReportRoute: (route) => !route.startsWith("/internal"),
});
```

| Option | Default | Purpose |
| --- | --- | --- |
| `captureRouteErrors` | `true` | Report failed route matches via `pushError` |
| `shouldReportRoute` | reports everything | Receives the resolved route pattern; return `false` to drop both the event and its errors |

## Signals

### `route_change`

| Attribute | Description |
| --- | --- |
| `toRoute` | Route pattern, e.g. `/posts/$postId` |
| `toUrl` | Full URL after navigation |
| `fromRoute` | Previous route pattern, omitted on the first navigation |
| `fromUrl` | Previous URL, omitted on the first navigation |
| `toRouteStatus` | Present only when the leaf match is not `success` |

### Route errors

Failed matches are reported with `pushError` under type `TanStackRouterError`, with
`route`, `url`, `errorSource` (`params` / `search` / `load`), and `cause`
(`preload` / `enter` / `stay`) in context.

TanStack's `errorComponent` catches loader failures itself, so they never reach a React
error boundary. This is the only way they reach Faro.

## Behaviour notes

✅ PUSH, BACK, and FORWARD navigations emit `route_change`.

❌ REPLACE navigations do not. TanStack treats typed search params as the idiomatic place to
hold UI state, so a debounced filter panel calling `navigate({ replace: true })` would
otherwise emit an event per keystroke. This matches `@grafana/faro-react`, which reports
only PUSH and POP.

✅ Redirects still emit exactly one event. TanStack applies `throw redirect(...)` as a
replace, but `resolvedLocation` only advances once a navigation settles, so a push that
redirects collapses into a single `route_change` landing on the final route.

❌ Route errors are not filtered by navigation type. A loader failure during a replace is
still reported even though no `route_change` is emitted.

### How the navigation type is determined

TanStack does not carry the history action on its router events. It is recovered from
`__TSR_index`, which `@tanstack/history` writes into location state positionally: `push`
stores `currentIndex + 1`, `replace` stores `currentIndex` unchanged. Comparing the index on
`fromLocation` and `toLocation` gives the action with no extra subscription.

A delta of `0` is a replace. Anything else is a push, back, or forward.

## Using with React

`@grafana/faro-react` provides the error boundary and component profiler, and both are
router-agnostic. Register `ReactIntegration` alongside this package with no `router` option:

```tsx
import { ReactIntegration } from "@grafana/faro-react";

instrumentations: [
  ...getWebInstrumentations(),
  new ReactIntegration(),
  new TanStackRouterInstrumentation(),
];
```

❌ Do not pass `createReactRouterV6Options` or `withFaroRouterInstrumentation` from
`@grafana/faro-react`. This package replaces the router half only.

## Framework support

Instrumentation targets `@tanstack/router-core`, which the React, Solid, and Vue adapters
all share. Router types are declared structurally rather than imported, so TanStack type
changes do not break the build.

`src/integration.test.ts` is what verifies those structural types still match a real router.
If TanStack changes shape, that test is where it surfaces.

## Development

```bash
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

`src/version.ts` is hand-synced with the `version` field in `package.json`. Update both
together.

## License

MIT
