import { BaseInstrumentation } from "@grafana/faro-web-sdk";

import { setDependencies } from "./dependencies";
import type { TanStackRouterInstrumentationOptions } from "./types";
import { VERSION } from "./version";

export class TanStackRouterInstrumentation extends BaseInstrumentation {
  readonly name = "faro-tanstack-router";
  readonly version = VERSION;

  private readonly instrumentationOptions: TanStackRouterInstrumentationOptions;

  constructor(options: TanStackRouterInstrumentationOptions = {}) {
    super();
    this.instrumentationOptions = options;
  }

  initialize(): void {
    setDependencies(this.api, this.internalLogger, this.instrumentationOptions);
  }
}
