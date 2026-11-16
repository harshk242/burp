"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during SSR and hydration, true once rendering on the client. */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
