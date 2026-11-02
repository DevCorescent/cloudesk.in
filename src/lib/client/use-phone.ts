"use client";

import { useSyncExternalStore } from "react";

/** Phone width: the same breakpoint as Tailwind's `max-sm:`. */
export const PHONE_QUERY = "(max-width: 639.98px)";

/** True on phone-width screens; false while rendering on the server. */
export function usePhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(PHONE_QUERY);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
