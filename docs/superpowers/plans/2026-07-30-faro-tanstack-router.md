# Faro TanStack Router Instrumentation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Faro instrumentation package that emits `route_change` events and route errors for TanStack Router, working across SPA and SSR from one code path.

**Architecture:** Two touchpoints, mirroring Faro's data-router setup. A `TanStackRouterInstrumentation` registered in `initializeFaro` captures Faro's `api` and `internalLogger` into module state; a `withFaroRouterInstrumentation(router)` wrapper subscribes to the router's `onResolved` event. All logic targets `@tanstack/router-core`'s structural shape, so React, Solid, and Vue adapters work unchanged.

**Tech Stack:** TypeScript, pnpm, Vitest (jsdom), tsup, oxlint, oxfmt.

**Spec:** `docs/superpowers/specs/2026-07-30-faro-tanstack-router-design.md`

## Global Constraints

- Package manager is **pnpm**. Add dependencies with `pnpm add`, never by editing `package.json` by hand.
- Lint with `oxlint`, format with `oxfmt`. Never `npx biome`.
- **No inline end-of-line comments.** Comments go on their own line above what they describe.
- Functional style throughout. The one exception is `TanStackRouterInstrumentation`, which must be a class because Faro's `BaseInstrumentation` is an abstract class — this is a framework requirement, not a style choice.
- The package must never touch `window`, `document`, or `location` at module scope. Runtime access to the URL goes through Faro's `globalObject`.
- Do not import types from `@tanstack/router-core` in `src/`. Router shapes are declared structurally in `src/types.ts` so TanStack's type churn cannot break the build. The integration test in Task 8 is what verifies the structural types still line up.
- Peer dependencies: `@grafana/faro-web-sdk` and `@tanstack/router-core`. Both are also devDependencies so tests can run.
- TypeScript `strict: true`.
- Event name must be `EVENT_ROUTE_CHANGE` imported from `@grafana/faro-web-sdk`, never the literal string.

---

### Task 1: Scaffold the project and the dependency module

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.oxlintrc.json`, `.gitignore`
- Create: `src/types.ts`
- Create: `src/dependencies.ts`
- Test: `src/dependencies.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `InstrumentableLocation`, `InstrumentableMatch`, `NavigationEvent`, `InstrumentableRouter`, `TanStackRouterInstrumentationOptions` from `./types`. From `./dependencies`: `api: API | undefined`, `internalLogger: InternalLogger | undefined`, `options: TanStackRouterInstrumentationOptions`, `isInitialized: boolean`, `setDependencies(api, internalLogger, options): void`, `warnNotInitialized(): void`, `resetDependencies(): void`.

- [ ] **Step 1: Initialise the repository and package**

```bash
cd /Users/palnes/src/faro-tanstack
git init
pnpm init
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add -D typescript vitest jsdom tsup oxlint oxfmt \
  @grafana/faro-web-sdk @tanstack/router-core
pnpm add -D --save-peer @grafana/faro-web-sdk @tanstack/router-core
```

- [ ] **Step 3: Write the config files**

`package.json` — merge these fields into what `pnpm init` produced, keeping the generated `name`, `version`, and `packageManager`:

```json
{
  "name": "faro-tanstack-router",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "oxlint src",
    "format": "oxfmt src",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    restoreMocks: true,
  },
})
```

`.oxlintrc.json`:

```json
{
  "categories": {
    "correctness": "error",
    "suspicious": "warn"
  }
}
```

`.gitignore`:

```
node_modules
dist
coverage
*.log
```

- [ ] **Step 4: Write `src/types.ts`**

These mirror the parts of TanStack's router that we read. Every field is optional where a test fake would otherwise be forced to invent a value.

```ts
import type { API, InternalLogger } from '@grafana/faro-web-sdk'

export interface InstrumentableLocation {
  href: string
  pathname: string
  state?: {
    __TSR_index?: number
  }
}

export type InstrumentableMatchStatus =
  | 'pending'
  | 'success'
  | 'error'
  | 'redirected'
  | 'notFound'

export interface InstrumentableMatch {
  id: string
  fullPath: string
  status: InstrumentableMatchStatus
  updatedAt: number
  error?: unknown
  paramsError?: unknown
  searchError?: unknown
  cause?: 'preload' | 'enter' | 'stay'
}

export interface NavigationEvent {
  toLocation: InstrumentableLocation
  fromLocation?: InstrumentableLocation
  hrefChanged: boolean
}

export interface InstrumentableRouter {
  isServer: boolean
  state: {
    matches: InstrumentableMatch[]
  }
  subscribe: (
    eventType: 'onResolved',
    fn: (event: NavigationEvent) => void,
  ) => () => void
}

export interface TanStackRouterInstrumentationOptions {
  captureRouteErrors?: boolean
  shouldReportRoute?: (route: string) => boolean
}

export type FaroDependencies = {
  api: API
  internalLogger: InternalLogger
}
```

- [ ] **Step 5: Write the failing test**

`src/dependencies.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  isInitialized,
  options,
  resetDependencies,
  setDependencies,
  warnNotInitialized,
} from './dependencies'
import * as dependencies from './dependencies'

const fakeApi = { pushEvent: vi.fn(), pushError: vi.fn() } as never
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never

describe('dependencies', () => {
  beforeEach(() => {
    resetDependencies()
  })

  it('starts uninitialised', () => {
    expect(isInitialized).toBe(false)
    expect(dependencies.api).toBeUndefined()
  })

  it('records the api, logger and options once set', () => {
    setDependencies(fakeApi, fakeLogger, { captureRouteErrors: false })

    expect(dependencies.isInitialized).toBe(true)
    expect(dependencies.api).toBe(fakeApi)
    expect(dependencies.internalLogger).toBe(fakeLogger)
    expect(dependencies.options.captureRouteErrors).toBe(false)
  })

  it('warns at most once when never initialised', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    warnNotInitialized()
    warnNotInitialized()
    warnNotInitialized()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('faro-tanstack-router')
  })

  it('defaults options to an empty object', () => {
    expect(options).toEqual({})
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm test src/dependencies.test.ts`
Expected: FAIL — cannot resolve `./dependencies`.

- [ ] **Step 7: Write `src/dependencies.ts`**

```ts
import type { API, InternalLogger } from '@grafana/faro-web-sdk'

import type { TanStackRouterInstrumentationOptions } from './types'

export let api: API | undefined
export let internalLogger: InternalLogger | undefined
export let options: TanStackRouterInstrumentationOptions = {}
export let isInitialized = false

let hasWarnedNotInitialized = false

export function setDependencies(
  newApi: API,
  newInternalLogger: InternalLogger,
  newOptions: TanStackRouterInstrumentationOptions,
): void {
  api = newApi
  internalLogger = newInternalLogger
  options = newOptions
  isInitialized = true
}

export function warnNotInitialized(): void {
  if (hasWarnedNotInitialized) {
    return
  }

  hasWarnedNotInitialized = true

  console.warn(
    '[faro-tanstack-router] Dropping router events: TanStackRouterInstrumentation was not registered. Add it to the instrumentations array passed to initializeFaro().',
  )
}

// Test-only. Resets module state between cases.
export function resetDependencies(): void {
  api = undefined
  internalLogger = undefined
  options = {}
  isInitialized = false
  hasWarnedNotInitialized = false
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm test src/dependencies.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 9: Lint, format, typecheck**

```bash
pnpm format && pnpm lint && pnpm typecheck
```

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold package and Faro dependency module"
```

---

### Task 2: Navigation type detection

Distinguishes PUSH/POP from REPLACE using the history index that `@tanstack/history` writes into location state. `push` stores `currentIndex + 1`, `replace` stores `currentIndex` unchanged.

**Files:**
- Create: `src/navigation.ts`
- Test: `src/navigation.test.ts`

**Interfaces:**
- Consumes: `NavigationEvent` from `./types`.
- Produces: `isReplaceNavigation(event: NavigationEvent): boolean`.

- [ ] **Step 1: Write the failing test**

`src/navigation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isReplaceNavigation } from './navigation'
import type { InstrumentableLocation, NavigationEvent } from './types'

function location(index?: number, pathname = '/'): InstrumentableLocation {
  return {
    href: `https://example.test${pathname}`,
    pathname,
    state: index === undefined ? {} : { __TSR_index: index },
  }
}

function event(
  toIndex: number | undefined,
  fromIndex?: number,
): NavigationEvent {
  return {
    toLocation: location(toIndex),
    fromLocation: fromIndex === undefined ? undefined : location(fromIndex),
    hrefChanged: true,
  }
}

describe('isReplaceNavigation', () => {
  it('treats an unchanged index as a replace', () => {
    expect(isReplaceNavigation(event(5, 5))).toBe(true)
  })

  it('treats an incremented index as a push', () => {
    expect(isReplaceNavigation(event(6, 5))).toBe(false)
  })

  it('treats a decremented index as a back navigation', () => {
    expect(isReplaceNavigation(event(4, 5))).toBe(false)
  })

  it('treats a multi-step jump as a go navigation', () => {
    expect(isReplaceNavigation(event(9, 5))).toBe(false)
  })

  it('treats the initial load with no fromLocation as reportable', () => {
    expect(isReplaceNavigation(event(0, undefined))).toBe(false)
  })

  it('reports the navigation when the index is absent', () => {
    expect(isReplaceNavigation(event(undefined, undefined))).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/navigation.test.ts`
Expected: FAIL — cannot resolve `./navigation`.

- [ ] **Step 3: Write `src/navigation.ts`**

```ts
import type { NavigationEvent } from './types'

const NO_PREVIOUS_INDEX = -1

export function isReplaceNavigation(event: NavigationEvent): boolean {
  const toIndex = event.toLocation.state?.__TSR_index

  if (typeof toIndex !== 'number') {
    return false
  }

  const fromIndex = event.fromLocation?.state?.__TSR_index
  const previousIndex =
    typeof fromIndex === 'number' ? fromIndex : NO_PREVIOUS_INDEX

  return toIndex - previousIndex === 0
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/navigation.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add -A
git commit -m "feat: detect replace navigations from the history index delta"
```

---

### Task 3: The route_change event

**Files:**
- Create: `src/routeChange.ts`
- Test: `src/routeChange.test.ts`

**Interfaces:**
- Consumes: `InstrumentableMatch`, `InstrumentableMatchStatus` from `./types`.
- Produces: `RouteTransition` (`{ fromRoute?: string; fromUrl?: string }`), `resolveRoute(matches: InstrumentableMatch[], fallbackPathname: string): string`, `buildRouteChangeAttributes(input: RouteChangeInput): EventAttributes`, `pushRouteChange(api: API, input: RouteChangeInput): RouteTransition` where `RouteChangeInput` is `{ toRoute: string; status?: InstrumentableMatchStatus; previous: RouteTransition }`.

- [ ] **Step 1: Write the failing test**

`src/routeChange.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildRouteChangeAttributes,
  pushRouteChange,
  resolveRoute,
} from './routeChange'
import type { InstrumentableMatch } from './types'

function match(overrides: Partial<InstrumentableMatch>): InstrumentableMatch {
  return {
    id: 'match-1',
    fullPath: '/posts',
    status: 'success',
    updatedAt: 1,
    ...overrides,
  }
}

describe('resolveRoute', () => {
  it('returns the leaf match route pattern', () => {
    const matches = [
      match({ id: 'a', fullPath: '/posts' }),
      match({ id: 'b', fullPath: '/posts/$postId' }),
    ]

    expect(resolveRoute(matches, '/posts/42')).toBe('/posts/$postId')
  })

  it('falls back to the pathname when there are no matches', () => {
    expect(resolveRoute([], '/posts/42')).toBe('/posts/42')
  })
})

describe('buildRouteChangeAttributes', () => {
  it('omits fromRoute and fromUrl on the first navigation', () => {
    const attributes = buildRouteChangeAttributes({
      toRoute: '/posts',
      previous: {},
    })

    expect(attributes).toEqual({
      toRoute: '/posts',
      toUrl: expect.any(String),
    })
  })

  it('includes the previous route and url on later navigations', () => {
    const attributes = buildRouteChangeAttributes({
      toRoute: '/posts/$postId',
      previous: { fromRoute: '/posts', fromUrl: 'https://example.test/posts' },
    })

    expect(attributes.fromRoute).toBe('/posts')
    expect(attributes.fromUrl).toBe('https://example.test/posts')
  })

  it('adds toRouteStatus only when the status is not success', () => {
    expect(
      buildRouteChangeAttributes({
        toRoute: '/missing',
        status: 'notFound',
        previous: {},
      }).toRouteStatus,
    ).toBe('notFound')

    expect(
      buildRouteChangeAttributes({
        toRoute: '/posts',
        status: 'success',
        previous: {},
      }).toRouteStatus,
    ).toBeUndefined()
  })

  it('reads the current url from the browser location', () => {
    window.history.replaceState({}, '', '/posts/42')

    expect(buildRouteChangeAttributes({ toRoute: '/posts/$postId', previous: {} }).toUrl).toContain(
      '/posts/42',
    )
  })
})

describe('pushRouteChange', () => {
  const pushEvent = vi.fn()
  const api = { pushEvent } as never

  beforeEach(() => {
    window.history.replaceState({}, '', '/posts')
  })

  it('pushes a route_change event', () => {
    pushRouteChange(api, { toRoute: '/posts', previous: {} })

    expect(pushEvent).toHaveBeenCalledWith(
      'route_change',
      expect.objectContaining({ toRoute: '/posts' }),
    )
  })

  it('returns the transition to use as the next fromRoute', () => {
    const next = pushRouteChange(api, { toRoute: '/posts', previous: {} })

    expect(next.fromRoute).toBe('/posts')
    expect(next.fromUrl).toContain('/posts')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/routeChange.test.ts`
Expected: FAIL — cannot resolve `./routeChange`.

- [ ] **Step 3: Write `src/routeChange.ts`**

```ts
import { EVENT_ROUTE_CHANGE, globalObject } from '@grafana/faro-web-sdk'
import type { API, EventAttributes } from '@grafana/faro-web-sdk'

import type { InstrumentableMatch, InstrumentableMatchStatus } from './types'

export interface RouteTransition {
  fromRoute?: string
  fromUrl?: string
}

export interface RouteChangeInput {
  toRoute: string
  status?: InstrumentableMatchStatus
  previous: RouteTransition
}

export function resolveRoute(
  matches: InstrumentableMatch[],
  fallbackPathname: string,
): string {
  return matches.at(-1)?.fullPath ?? fallbackPathname
}

function currentUrl(): string {
  return globalObject.location?.href ?? ''
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
    ...(status === undefined || status === 'success' ? {} : { toRouteStatus: status }),
  }
}

export function pushRouteChange(api: API, input: RouteChangeInput): RouteTransition {
  const attributes = buildRouteChangeAttributes(input)

  api.pushEvent(EVENT_ROUTE_CHANGE, attributes)

  return {
    fromRoute: attributes['toRoute'],
    fromUrl: attributes['toUrl'],
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/routeChange.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add -A
git commit -m "feat: build and push route_change events"
```

---

### Task 4: Route error reporting

**Files:**
- Create: `src/routeErrors.ts`
- Test: `src/routeErrors.test.ts`

**Interfaces:**
- Consumes: `InstrumentableMatch` from `./types`.
- Produces: `getErrorSource(match: InstrumentableMatch): 'params' | 'search' | 'load'`, `toError(value: unknown): Error`, `createRouteErrorReporter(maxSeenKeys?: number): (api: API, matches: InstrumentableMatch[]) => void`.

- [ ] **Step 1: Write the failing test**

`src/routeErrors.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createRouteErrorReporter, getErrorSource, toError } from './routeErrors'
import type { InstrumentableMatch } from './types'

function match(overrides: Partial<InstrumentableMatch>): InstrumentableMatch {
  return {
    id: 'match-1',
    fullPath: '/posts/$postId',
    status: 'error',
    updatedAt: 1,
    cause: 'enter',
    ...overrides,
  }
}

describe('getErrorSource', () => {
  it('reports params errors', () => {
    expect(getErrorSource(match({ paramsError: new Error('bad param') }))).toBe('params')
  })

  it('reports search errors', () => {
    expect(getErrorSource(match({ searchError: new Error('bad search') }))).toBe('search')
  })

  it('reports everything else as a load error', () => {
    expect(getErrorSource(match({ error: new Error('loader blew up') }))).toBe('load')
  })
})

describe('toError', () => {
  it('passes an Error through unchanged', () => {
    const err = new Error('boom')

    expect(toError(err)).toBe(err)
  })

  it('wraps a non-Error value', () => {
    expect(toError('boom')).toBeInstanceOf(Error)
    expect(toError('boom').message).toBe('boom')
  })
})

describe('createRouteErrorReporter', () => {
  const pushError = vi.fn()
  const api = { pushError } as never

  beforeEach(() => {
    window.history.replaceState({}, '', '/posts/42')
  })

  it('ignores matches that did not error', () => {
    createRouteErrorReporter()(api, [match({ status: 'success' })])

    expect(pushError).not.toHaveBeenCalled()
  })

  it('pushes one error per failed match with route context', () => {
    createRouteErrorReporter()(api, [match({ error: new Error('loader blew up') })])

    expect(pushError).toHaveBeenCalledTimes(1)
    expect(pushError.mock.calls[0]?.[1]).toEqual({
      type: 'TanStackRouterError',
      context: {
        route: '/posts/$postId',
        url: expect.stringContaining('/posts/42'),
        errorSource: 'load',
        cause: 'enter',
      },
    })
  })

  it('does not report the same match twice', () => {
    const report = createRouteErrorReporter()
    const matches = [match({ error: new Error('loader blew up') })]

    report(api, matches)
    report(api, matches)

    expect(pushError).toHaveBeenCalledTimes(1)
  })

  it('reports again when the match is re-run', () => {
    const report = createRouteErrorReporter()

    report(api, [match({ error: new Error('first'), updatedAt: 1 })])
    report(api, [match({ error: new Error('second'), updatedAt: 2 })])

    expect(pushError).toHaveBeenCalledTimes(2)
  })

  it('evicts the oldest key once the cap is reached', () => {
    const report = createRouteErrorReporter(2)

    report(api, [match({ id: 'a', error: new Error('a') })])
    report(api, [match({ id: 'b', error: new Error('b') })])
    report(api, [match({ id: 'c', error: new Error('c') })])
    report(api, [match({ id: 'a', error: new Error('a') })])

    expect(pushError).toHaveBeenCalledTimes(4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/routeErrors.test.ts`
Expected: FAIL — cannot resolve `./routeErrors`.

- [ ] **Step 3: Write `src/routeErrors.ts`**

```ts
import { globalObject } from '@grafana/faro-web-sdk'
import type { API } from '@grafana/faro-web-sdk'

import type { InstrumentableMatch } from './types'

const DEFAULT_MAX_SEEN_KEYS = 100

export type RouteErrorReporter = (api: API, matches: InstrumentableMatch[]) => void

export function getErrorSource(
  match: InstrumentableMatch,
): 'params' | 'search' | 'load' {
  if (match.paramsError !== undefined && match.paramsError !== null) {
    return 'params'
  }

  if (match.searchError !== undefined && match.searchError !== null) {
    return 'search'
  }

  return 'load'
}

export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null)
}

export function createRouteErrorReporter(
  maxSeenKeys: number = DEFAULT_MAX_SEEN_KEYS,
): RouteErrorReporter {
  const seen = new Set<string>()

  function remember(key: string): void {
    seen.add(key)

    if (seen.size > maxSeenKeys) {
      const oldest = seen.values().next().value

      if (oldest !== undefined) {
        seen.delete(oldest)
      }
    }
  }

  return (api, matches) => {
    for (const match of matches) {
      if (match.status !== 'error') {
        continue
      }

      const key = `${match.id}:${match.updatedAt}`

      if (seen.has(key)) {
        continue
      }

      remember(key)

      api.pushError(
        toError(firstDefined(match.error, match.paramsError, match.searchError)),
        {
          type: 'TanStackRouterError',
          context: {
            route: match.fullPath,
            url: globalObject.location?.href ?? '',
            errorSource: getErrorSource(match),
            ...(match.cause === undefined ? {} : { cause: match.cause }),
          },
        },
      )
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/routeErrors.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add -A
git commit -m "feat: report failed route matches with deduplication"
```

---

### Task 5: The instrumentation class

**Files:**
- Create: `src/version.ts`
- Create: `src/instrumentation.ts`
- Test: `src/instrumentation.test.ts`

**Interfaces:**
- Consumes: `setDependencies` from `./dependencies`, `TanStackRouterInstrumentationOptions` from `./types`.
- Produces: `VERSION: string` from `./version`, `TanStackRouterInstrumentation` class with `name`, `version`, and `initialize(): void`.

`VERSION` is our own package version, not Faro's. Faro's first-party packages import `VERSION` from `@grafana/faro-web-sdk` because they are released in lockstep with it; we are not, so reusing it would misreport which package produced a signal. Keep `src/version.ts` in sync with `package.json` on release.

- [ ] **Step 1: Write the failing test**

`src/instrumentation.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as dependencies from './dependencies'
import { resetDependencies } from './dependencies'
import { TanStackRouterInstrumentation } from './instrumentation'
import { VERSION } from './version'

const fakeApi = { pushEvent: vi.fn(), pushError: vi.fn() } as never
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never

function initialise(options?: ConstructorParameters<typeof TanStackRouterInstrumentation>[0]) {
  const instrumentation = new TanStackRouterInstrumentation(options)

  instrumentation.api = fakeApi
  instrumentation.internalLogger = fakeLogger
  instrumentation.initialize()

  return instrumentation
}

describe('TanStackRouterInstrumentation', () => {
  beforeEach(() => {
    resetDependencies()
  })

  it('identifies itself', () => {
    const instrumentation = new TanStackRouterInstrumentation()

    expect(instrumentation.name).toBe('faro-tanstack-router')
    expect(instrumentation.version).toBe(VERSION)
  })

  it('publishes the Faro api and logger on initialize', () => {
    initialise()

    expect(dependencies.isInitialized).toBe(true)
    expect(dependencies.api).toBe(fakeApi)
    expect(dependencies.internalLogger).toBe(fakeLogger)
  })

  it('publishes the options it was constructed with', () => {
    const shouldReportRoute = () => true

    initialise({ captureRouteErrors: false, shouldReportRoute })

    expect(dependencies.options.captureRouteErrors).toBe(false)
    expect(dependencies.options.shouldReportRoute).toBe(shouldReportRoute)
  })

  it('defaults to an empty options object', () => {
    initialise()

    expect(dependencies.options).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/instrumentation.test.ts`
Expected: FAIL — cannot resolve `./instrumentation`.

- [ ] **Step 3: Write `src/version.ts`**

```ts
export const VERSION = '0.1.0'
```

- [ ] **Step 4: Write `src/instrumentation.ts`**

```ts
import { BaseInstrumentation } from '@grafana/faro-web-sdk'

import { setDependencies } from './dependencies'
import type { TanStackRouterInstrumentationOptions } from './types'
import { VERSION } from './version'

export class TanStackRouterInstrumentation extends BaseInstrumentation {
  readonly name = 'faro-tanstack-router'
  readonly version = VERSION

  private readonly instrumentationOptions: TanStackRouterInstrumentationOptions

  constructor(options: TanStackRouterInstrumentationOptions = {}) {
    super()
    this.instrumentationOptions = options
  }

  initialize(): void {
    setDependencies(this.api, this.internalLogger, this.instrumentationOptions)
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/instrumentation.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add -A
git commit -m "feat: add TanStackRouterInstrumentation"
```

---

### Task 6: The router wrapper

Ties everything together. Guards SSR, guards double-wrapping, and runs the two independent branches: `route_change` and error reporting.

**Files:**
- Create: `src/withFaroRouterInstrumentation.ts`
- Test: `src/withFaroRouterInstrumentation.test.ts`

**Interfaces:**
- Consumes: `api`, `internalLogger`, `isInitialized`, `options`, `warnNotInitialized` from `./dependencies`; `isReplaceNavigation` from `./navigation`; `pushRouteChange`, `resolveRoute`, `RouteTransition` from `./routeChange`; `createRouteErrorReporter` from `./routeErrors`; `InstrumentableRouter`, `NavigationEvent` from `./types`.
- Produces: `withFaroRouterInstrumentation<TRouter extends InstrumentableRouter>(router: TRouter): TRouter`.

Double-wrap protection uses a module-level `WeakSet` rather than a marker property on the router. It avoids mutating a user-owned object and avoids the TypeScript friction of indexing with a non-`unique symbol` key.

- [ ] **Step 1: Write the failing test**

`src/withFaroRouterInstrumentation.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetDependencies, setDependencies } from './dependencies'
import type {
  InstrumentableMatch,
  InstrumentableRouter,
  NavigationEvent,
} from './types'
import { withFaroRouterInstrumentation } from './withFaroRouterInstrumentation'

const pushEvent = vi.fn()
const pushError = vi.fn()
const fakeApi = { pushEvent, pushError } as never
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never

function match(overrides: Partial<InstrumentableMatch> = {}): InstrumentableMatch {
  return {
    id: 'match-1',
    fullPath: '/posts/$postId',
    status: 'success',
    updatedAt: 1,
    ...overrides,
  }
}

function createFakeRouter(matches: InstrumentableMatch[] = [match()]) {
  const listeners: Array<(event: NavigationEvent) => void> = []

  const router: InstrumentableRouter & {
    emit: (event: NavigationEvent) => void
    setMatches: (next: InstrumentableMatch[]) => void
  } = {
    isServer: false,
    state: { matches },
    subscribe: (_eventType, fn) => {
      listeners.push(fn)
      return () => {
        listeners.splice(listeners.indexOf(fn), 1)
      }
    },
    emit: (event) => {
      for (const listener of listeners) {
        listener(event)
      }
    },
    setMatches: (next) => {
      router.state.matches = next
    },
  }

  return router
}

function navigation(
  toIndex: number,
  fromIndex?: number,
  pathname = '/posts/42',
): NavigationEvent {
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
            href: 'https://example.test/posts',
            pathname: '/posts',
            state: { __TSR_index: fromIndex },
          },
    hrefChanged: true,
  }
}

describe('withFaroRouterInstrumentation', () => {
  beforeEach(() => {
    resetDependencies()
    window.history.replaceState({}, '', '/posts/42')
  })

  it('returns the same router instance', () => {
    const router = createFakeRouter()

    expect(withFaroRouterInstrumentation(router)).toBe(router)
  })

  it('does not subscribe on the server', () => {
    const router = createFakeRouter()
    router.isServer = true
    const subscribe = vi.spyOn(router, 'subscribe')

    withFaroRouterInstrumentation(router)

    expect(subscribe).not.toHaveBeenCalled()
  })

  it('subscribes only once when wrapped twice', () => {
    const router = createFakeRouter()
    const subscribe = vi.spyOn(router, 'subscribe')

    withFaroRouterInstrumentation(router)
    withFaroRouterInstrumentation(router)

    expect(subscribe).toHaveBeenCalledTimes(1)
  })

  it('drops events and warns once when never initialised', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = withFaroRouterInstrumentation(createFakeRouter())

    router.emit(navigation(1, 0))
    router.emit(navigation(2, 1))

    expect(pushEvent).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('emits route_change with the route pattern', () => {
    setDependencies(fakeApi, fakeLogger, {})
    const router = withFaroRouterInstrumentation(createFakeRouter())

    router.emit(navigation(1, 0))

    expect(pushEvent).toHaveBeenCalledWith(
      'route_change',
      expect.objectContaining({ toRoute: '/posts/$postId' }),
    )
  })

  it('carries the previous route into the next navigation', () => {
    setDependencies(fakeApi, fakeLogger, {})
    const router = withFaroRouterInstrumentation(createFakeRouter())

    router.emit(navigation(1, 0))
    router.setMatches([match({ fullPath: '/users' })])
    router.emit(navigation(2, 1))

    expect(pushEvent.mock.calls[1]?.[1]).toMatchObject({
      toRoute: '/users',
      fromRoute: '/posts/$postId',
    })
  })

  it('skips replace navigations', () => {
    setDependencies(fakeApi, fakeLogger, {})
    const router = withFaroRouterInstrumentation(createFakeRouter())

    router.emit(navigation(3, 3))

    expect(pushEvent).not.toHaveBeenCalled()
  })

  it('skips navigations where the href did not change', () => {
    setDependencies(fakeApi, fakeLogger, {})
    const router = withFaroRouterInstrumentation(createFakeRouter())

    router.emit({ ...navigation(1, 0), hrefChanged: false })

    expect(pushEvent).not.toHaveBeenCalled()
  })

  it('reports route errors even on a replace navigation', () => {
    setDependencies(fakeApi, fakeLogger, {})
    const router = withFaroRouterInstrumentation(
      createFakeRouter([match({ status: 'error', error: new Error('boom') })]),
    )

    router.emit(navigation(3, 3))

    expect(pushEvent).not.toHaveBeenCalled()
    expect(pushError).toHaveBeenCalledTimes(1)
  })

  it('honours captureRouteErrors: false', () => {
    setDependencies(fakeApi, fakeLogger, { captureRouteErrors: false })
    const router = withFaroRouterInstrumentation(
      createFakeRouter([match({ status: 'error', error: new Error('boom') })]),
    )

    router.emit(navigation(1, 0))

    expect(pushError).not.toHaveBeenCalled()
  })

  it('honours shouldReportRoute', () => {
    setDependencies(fakeApi, fakeLogger, {
      shouldReportRoute: (route) => route !== '/posts/$postId',
    })
    const router = withFaroRouterInstrumentation(createFakeRouter())

    router.emit(navigation(1, 0))

    expect(pushEvent).not.toHaveBeenCalled()
  })

  it('reports the route when shouldReportRoute throws', () => {
    setDependencies(fakeApi, fakeLogger, {
      shouldReportRoute: () => {
        throw new Error('predicate blew up')
      },
    })
    const router = withFaroRouterInstrumentation(createFakeRouter())

    router.emit(navigation(1, 0))

    expect(pushEvent).toHaveBeenCalledTimes(1)
  })

  it('falls back to the pathname when there are no matches', () => {
    setDependencies(fakeApi, fakeLogger, {})
    const router = withFaroRouterInstrumentation(createFakeRouter([]))

    router.emit(navigation(1, 0))

    expect(pushEvent).toHaveBeenCalledWith(
      'route_change',
      expect.objectContaining({ toRoute: '/posts/42' }),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/withFaroRouterInstrumentation.test.ts`
Expected: FAIL — cannot resolve `./withFaroRouterInstrumentation`.

- [ ] **Step 3: Write `src/withFaroRouterInstrumentation.ts`**

```ts
import * as dependencies from './dependencies'
import { warnNotInitialized } from './dependencies'
import { isReplaceNavigation } from './navigation'
import { pushRouteChange, resolveRoute } from './routeChange'
import type { RouteTransition } from './routeChange'
import { createRouteErrorReporter } from './routeErrors'
import type { InstrumentableRouter } from './types'

const instrumentedRouters = new WeakSet<object>()

function shouldReportRoute(route: string): boolean {
  const predicate = dependencies.options.shouldReportRoute

  if (predicate === undefined) {
    return true
  }

  try {
    return predicate(route)
  } catch (err) {
    dependencies.internalLogger?.error(
      '[faro-tanstack-router] shouldReportRoute threw, reporting the route anyway',
      err,
    )

    return true
  }
}

export function withFaroRouterInstrumentation<TRouter extends InstrumentableRouter>(
  router: TRouter,
): TRouter {
  if (router.isServer || instrumentedRouters.has(router)) {
    return router
  }

  instrumentedRouters.add(router)

  let previous: RouteTransition = {}
  const reportRouteErrors = createRouteErrorReporter()

  router.subscribe('onResolved', (event) => {
    const api = dependencies.api

    if (!dependencies.isInitialized || api === undefined) {
      warnNotInitialized()
      return
    }

    const matches = router.state.matches
    const toRoute = resolveRoute(matches, event.toLocation.pathname)

    if (!shouldReportRoute(toRoute)) {
      return
    }

    if (event.hrefChanged && !isReplaceNavigation(event)) {
      previous = pushRouteChange(api, {
        toRoute,
        status: matches.at(-1)?.status,
        previous,
      })
    }

    if (dependencies.options.captureRouteErrors !== false) {
      reportRouteErrors(api, matches)
    }
  })

  return router
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/withFaroRouterInstrumentation.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test`
Expected: PASS, 45 tests across 5 files.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint && pnpm typecheck
git add -A
git commit -m "feat: subscribe to router navigation and report telemetry"
```

---

### Task 7: Public exports, build, and README

**Files:**
- Create: `src/index.ts`
- Create: `README.md`
- Modify: `package.json` (only if `pnpm build` reveals a missing field)

**Interfaces:**
- Consumes: everything built so far.
- Produces: the package's public surface.

- [ ] **Step 1: Write `src/index.ts`**

```ts
export { TanStackRouterInstrumentation } from './instrumentation'
export { withFaroRouterInstrumentation } from './withFaroRouterInstrumentation'
export { VERSION } from './version'

export type {
  InstrumentableLocation,
  InstrumentableMatch,
  InstrumentableMatchStatus,
  InstrumentableRouter,
  NavigationEvent,
  TanStackRouterInstrumentationOptions,
} from './types'
```

- [ ] **Step 2: Verify the build produces both formats**

Run: `pnpm build`
Expected: `dist/index.js`, `dist/index.cjs`, and `dist/index.d.ts` all exist. Confirm with `ls dist`.

- [ ] **Step 3: Write `README.md`**

Follow the house README style: module name and one-liner, a structure table, TypeScript examples with imports, reference tone, and ✅/❌ for do's and don'ts.

````markdown
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
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { getWebInstrumentations, initializeFaro } from '@grafana/faro-web-sdk'
import {
  TanStackRouterInstrumentation,
  withFaroRouterInstrumentation,
} from 'faro-tanstack-router'

import { routeTree } from './routeTree.gen'

initializeFaro({
  url: 'https://faro-collector.example.net/collect/<key>',
  app: { name: 'my-app', version: '1.0.0' },
  instrumentations: [...getWebInstrumentations(), new TanStackRouterInstrumentation()],
})

const router = withFaroRouterInstrumentation(createRouter({ routeTree }))

export function App() {
  return <RouterProvider router={router} />
}
```

## TanStack Start

```tsx
import { createRouter } from '@tanstack/react-router'
import { withFaroRouterInstrumentation } from 'faro-tanstack-router'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  return withFaroRouterInstrumentation(createRouter({ routeTree }))
}
```

`getRouter` runs on the server too. The wrapper returns the router untouched when
`router.isServer` is true, so no subscription and no telemetry happen server-side.

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

## Using with React

`@grafana/faro-react` provides the error boundary and component profiler, and both are
router-agnostic. Register `ReactIntegration` alongside this package with no `router` option:

```tsx
import { ReactIntegration } from '@grafana/faro-react'

instrumentations: [
  ...getWebInstrumentations(),
  new ReactIntegration(),
  new TanStackRouterInstrumentation(),
]
```

❌ Do not pass `createReactRouterV6Options` or `withFaroRouterInstrumentation` from
`@grafana/faro-react`. This package replaces the router half only.
````

- [ ] **Step 4: Verify the public surface imports cleanly**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format && pnpm lint
git add -A
git commit -m "feat: add public exports, build config and README"
```

---

### Task 8: Integration test against a real router

The structural types in `src/types.ts` are the one place this package can silently drift from TanStack. This task proves a real `@tanstack/react-router` instance satisfies them and that a real navigation produces an event.

**Files:**
- Create: `src/integration.test.ts`
- Modify: `package.json` via `pnpm add -D` only

**Interfaces:**
- Consumes: the full public surface.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Install the real router**

```bash
pnpm add -D @tanstack/react-router react react-dom @types/react @types/react-dom
```

- [ ] **Step 2: Write the failing test**

`src/integration.test.ts`:

```ts
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetDependencies, setDependencies } from './dependencies'
import { withFaroRouterInstrumentation } from './withFaroRouterInstrumentation'

const pushEvent = vi.fn()
const fakeApi = { pushEvent, pushError: vi.fn() } as never
const fakeLogger = { error: vi.fn(), debug: vi.fn() } as never

function createTestRouter() {
  const rootRoute = createRootRoute()

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => null,
  })

  const postRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/posts/$postId',
    component: () => null,
  })

  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute, postRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
}

describe('integration with @tanstack/react-router', () => {
  beforeEach(() => {
    resetDependencies()
    setDependencies(fakeApi, fakeLogger, {})
  })

  it('accepts a real router instance', () => {
    const router = createTestRouter()

    expect(withFaroRouterInstrumentation(router)).toBe(router)
  })

  it('emits route_change with the parameterised route pattern', async () => {
    const router = withFaroRouterInstrumentation(createTestRouter())

    await router.load()
    pushEvent.mockClear()

    await router.navigate({ to: '/posts/$postId', params: { postId: '42' } })
    await router.invalidate()

    expect(pushEvent).toHaveBeenCalledWith(
      'route_change',
      expect.objectContaining({ toRoute: '/posts/$postId' }),
    )
  })
})
```

- [ ] **Step 3: Run the test**

Run: `pnpm test src/integration.test.ts`
Expected: FAIL on first run.

There are two plausible failure modes, and they need different responses:

1. **A TypeScript error where `withFaroRouterInstrumentation(router)` is called.** The structural types in `src/types.ts` do not match the real router. Fix `src/types.ts` to be more permissive — this is the drift the task exists to catch. Do not cast the router in the test to silence it.
2. **`pushEvent` not called.** `onResolved` is emitted from the React adapter's `Transitioner`, which only runs when a `RouterProvider` is mounted. If a headless `router.load()` / `router.navigate()` does not emit `onResolved`, render the router with `@testing-library/react` instead. Install it with `pnpm add -D @testing-library/react` and drive navigation through a mounted `RouterProvider`.

- [ ] **Step 4: Make the test pass**

Apply whichever fix the failure calls for, then re-run until green.

Run: `pnpm test src/integration.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run everything**

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: verify structural types against a real TanStack router"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: module layout → Tasks 1–7; two-touchpoint architecture → Tasks 5 and 6; `route_change` attribute table → Task 3; error context table and dedupe cap → Task 4; navigation type filtering via history index → Task 2, wired in Task 6; SSR guard → Task 6; error handling table → Tasks 4 and 6; testing case list → Tasks 2, 3, 4, 6, 8; tooling → Task 1; README documentation of divergences → Task 7.

**Refinements against the spec, deliberate:**
- The spec's `src/routeChange.ts` was split, with navigation type detection moved to its own `src/navigation.ts`. It is the subtlest logic in the package and deserves isolated tests.
- The spec proposed a symbol marker on the router for double-wrap protection. Task 6 uses a module-level `WeakSet` instead: no mutation of a user-owned object, and no TypeScript friction from indexing with a non-`unique symbol` key.
- `src/version.ts` was added. The spec did not say where `version` comes from, and reusing Faro's `VERSION` would misreport the producing package.

**Open item carried from the spec.** The package name `faro-tanstack-router` is still provisional. It appears in `package.json`, `README.md`, and the `console.warn` string in `src/dependencies.ts`. Changing it later means touching those three places.
