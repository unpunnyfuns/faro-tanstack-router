import type { NavigationEvent } from "./types";

const NO_PREVIOUS_INDEX = -1;

export function isReplaceNavigation(event: NavigationEvent): boolean {
  const toIndex = event.toLocation.state?.__TSR_index;

  if (typeof toIndex !== "number") {
    return false;
  }

  const fromIndex = event.fromLocation?.state?.__TSR_index;
  const previousIndex = typeof fromIndex === "number" ? fromIndex : NO_PREVIOUS_INDEX;

  return toIndex - previousIndex === 0;
}
