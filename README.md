# @unpunnyfuns/faro-tanstack-router

Grafana Faro instrumentation for TanStack Router. Emits `route_change` events and reports
failed route matches, for SPA and SSR.

## Exports

| Export | Type | Purpose |
| --- | --- | --- |
| `TanStackRouterInstrumentation` | class | Register in `initializeFaro` to supply Faro's api and hold options |
| `withFaroRouterInstrumentation` | function | Wrap a router instance to subscribe to navigation |
| `TanStackRouterInstrumentationOptions` | type | `captureRouteErrors`, `shouldReportRoute` |

Both calls are required. Where each one goes depends on whether you are running a SPA or
SSR — see the setup below.

## Install

```bash
npm install @unpunnyfuns/faro-tanstack-router @grafana/faro-web-sdk
```

## SPA

```tsx
import { getWebInstrumentations, initializeFaro } from "@grafana/faro-web-sdk";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import {
  TanStackRouterInstrumentation,
  withFaroRouterInstrumentation,
} from "@unpunnyfuns/faro-tanstack-router";

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

In a SPA both calls sit in the same file, and their order does not matter.

## TanStack Start

SSR needs the same two calls, but in different places. Wrap the router in `getRouter`:

```tsx
// src/router.tsx
import { createRouter } from "@tanstack/react-router";
import { withFaroRouterInstrumentation } from "@unpunnyfuns/faro-tanstack-router";

import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return withFaroRouterInstrumentation(createRouter({ routeTree }));
}
```

`getRouter` runs on the server too. The wrapper returns the router untouched when
`router.isServer` is true, so no subscription and no telemetry happen server-side.

Then initialise Faro on the client only, because `initializeFaro` needs `window`:

```tsx
// src/routes/__root.tsx
import { getWebInstrumentations, initializeFaro } from "@grafana/faro-web-sdk";
import { TanStackRouterInstrumentation } from "@unpunnyfuns/faro-tanstack-router";

if (typeof window !== "undefined") {
  initializeFaro({
    url: import.meta.env.VITE_FARO_URL,
    app: { name: "my-app", version: "1.0.0" },
    instrumentations: [...getWebInstrumentations(), new TanStackRouterInstrumentation()],
  });
}
```

❌ Wrapping the router without registering the instrumentation is the common mistake. The
wrapper subscribes on hydration, finds Faro uninitialised, and drops every event after a
single `console.warn`.

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
| `shouldReportRoute` | reports everything | Return `false` to drop both the event and its errors |

`shouldReportRoute` receives the resolved route pattern, such as `/posts/$postId`. When no
route matches, it receives the concrete pathname instead.

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

Failed matches are reported with `pushError` under type `TanStackRouterError`, with `route`,
`url`, `errorSource` (`params` / `search` / `load`) and `cause` (`preload` / `enter` / `stay`)
in context.

TanStack's `errorComponent` catches loader failures itself, so they never reach a React error
boundary. This package is the only way they reach Faro.

## Behaviour

✅ PUSH, BACK and FORWARD navigations emit `route_change`.

❌ REPLACE navigations do not. This matches `@grafana/faro-react`, which reports only PUSH and
POP, and keeps search-parameter updates made with `navigate({ replace: true })` from emitting
an event per change.

✅ Redirects emit exactly one event, landing on the final route.

❌ Route errors are not filtered by navigation type. A loader failure during a replace is still
reported even though no `route_change` is emitted.

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

❌ Do not pass `createReactRouterV6Options`, or `withFaroRouterInstrumentation` from
`@grafana/faro-react`. This package replaces the router half only.

## Framework support

Instrumentation targets `@tanstack/router-core`, which the React, Solid and Vue adapters all
share.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, the release process and design
notes.

## License

MIT
