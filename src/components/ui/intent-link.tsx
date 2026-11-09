"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link that prefetches its screen once the pointer, a finger or the keyboard
 * reaches it, instead of as soon as it's on screen — the sidebar has dozens of
 * links, and prefetching them all on every load would ask the server for each.
 */
export function IntentLink({ onPointerEnter, onTouchStart, onFocus, ...props }: ComponentProps<typeof Link>) {
  const [intent, setIntent] = useState(false);
  return (
    <Link
      {...props}
      prefetch={intent ? null : false}
      onPointerEnter={(e) => {
        setIntent(true);
        onPointerEnter?.(e);
      }}
      onTouchStart={(e) => {
        setIntent(true);
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        setIntent(true);
        onFocus?.(e);
      }}
    />
  );
}
