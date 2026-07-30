import { describe, expect, it } from "vitest";

import { isReplaceNavigation } from "./navigation";
import type { InstrumentableLocation, NavigationEvent } from "./types";

function location(index?: number, pathname = "/"): InstrumentableLocation {
  return {
    href: `https://example.test${pathname}`,
    pathname,
    state: index === undefined ? {} : { __TSR_index: index },
  };
}

function event(toIndex: number | undefined, fromIndex?: number): NavigationEvent {
  return {
    toLocation: location(toIndex),
    fromLocation: fromIndex === undefined ? undefined : location(fromIndex),
    hrefChanged: true,
  };
}

describe("isReplaceNavigation", () => {
  it("treats an unchanged index as a replace", () => {
    expect(isReplaceNavigation(event(5, 5))).toBe(true);
  });

  it("treats an incremented index as a push", () => {
    expect(isReplaceNavigation(event(6, 5))).toBe(false);
  });

  it("treats a decremented index as a back navigation", () => {
    expect(isReplaceNavigation(event(4, 5))).toBe(false);
  });

  it("treats a multi-step jump as a go navigation", () => {
    expect(isReplaceNavigation(event(9, 5))).toBe(false);
  });

  it("treats the initial load with no fromLocation as reportable", () => {
    expect(isReplaceNavigation(event(0, undefined))).toBe(false);
  });

  it("reports the navigation when the index is absent", () => {
    expect(isReplaceNavigation(event(undefined, undefined))).toBe(false);
  });
});
