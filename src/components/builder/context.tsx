"use client";

import { createContext, useContext } from "react";
import type { Breakpoint, SiteDoc } from "@/lib/site/model";

export type PickImage = (onPick: (url: string, alt?: string) => void) => void;

export type BuilderCtx = {
  projectId: string;
  viewport: Breakpoint;
  setViewport: (v: Breakpoint) => void;
  openMedia: PickImage;
  readOnly: boolean;
  update: (mutate: (d: SiteDoc) => void, key?: string) => void;
};

export const BuilderContext = createContext<BuilderCtx | null>(null);

export function useBuilder() {
  const v = useContext(BuilderContext);
  if (!v) throw new Error("useBuilder outside BuilderContext");
  return v;
}
