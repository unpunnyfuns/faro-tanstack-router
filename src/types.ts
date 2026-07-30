export interface InstrumentableLocation {
  href: string;
  pathname: string;
  state?: {
    __TSR_index?: number;
  };
}

export type InstrumentableMatchStatus = "pending" | "success" | "error" | "redirected" | "notFound";

export interface InstrumentableMatch {
  id: string;
  fullPath: string;
  status: InstrumentableMatchStatus;
  updatedAt: number;
  error?: unknown;
  paramsError?: unknown;
  searchError?: unknown;
  cause?: "preload" | "enter" | "stay";
}

export interface NavigationEvent {
  toLocation: InstrumentableLocation;
  fromLocation?: InstrumentableLocation;
  hrefChanged: boolean;
}

export interface InstrumentableRouter {
  isServer: boolean;
  state: {
    matches: InstrumentableMatch[];
  };
  subscribe: (eventType: "onResolved", fn: (event: NavigationEvent) => void) => () => void;
}

export interface TanStackRouterInstrumentationOptions {
  captureRouteErrors?: boolean;
  shouldReportRoute?: (route: string) => boolean;
}
