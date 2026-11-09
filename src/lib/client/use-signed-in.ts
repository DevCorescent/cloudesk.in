"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether this browser is signed in, for website pages served from the edge
 * cache (they can't read the session): the proxy keeps a readable `cc_in`
 * flag beside the private session cookie. False while rendering on the server.
 */
export function useSignedIn() {
  return useSyncExternalStore(
    () => () => {},
    () => /(?:^|;\s*)cc_in=1(?:;|$)/.test(document.cookie),
    () => false,
  );
}
