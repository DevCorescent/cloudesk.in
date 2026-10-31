// Shared helpers for capture scripts: a clean screenshot (no dev badge, no
// toasts, settled animations) saved as a JPEG under public/marketing/<dir>/.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export async function clean(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important} [data-sonner-toaster],[role=region][aria-label*=otification]{display:none!important} *,*::before,*::after{caret-color:transparent!important}" }).catch(() => {});
}

export async function shoot(page: Page, dir: string, name: string, opts: { settle?: number; clip?: { x: number; y: number; width: number; height: number }; fullPage?: boolean } = {}) {
  await clean(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(opts.settle ?? 1200);
  const out = join(process.cwd(), "public", "marketing", dir);
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: join(out, `${name}.jpg`), type: "jpeg", quality: 82, clip: opts.clip, fullPage: opts.fullPage });
}

/** A unique, believable client address per run so the dev sign-up limiter never trips. */
export const ip = () => `10.${120 + Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/**
 * The same signed-in workspace on a phone (402×874 at 3×, touch): each path is
 * shot to public/marketing/phones/<slug>.jpg — the feature's own mobile layout,
 * shown on the marketing site when it's viewed on a phone.
 */
export async function phoneShots(page: Page, shots: [path: string, slug: string][], opts: { settle?: number } = {}) {
  const browser = page.context().browser();
  if (!browser) return;
  const ctx = await browser.newContext({ baseURL: process.env.CAPTURE_URL ?? "http://localhost:3000", viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "light", storageState: await page.context().storageState() });
  const m = await ctx.newPage();
  try {
    for (const [path, slug] of shots) {
      await m.goto(path, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await m.waitForLoadState("networkidle").catch(() => {});
      const skip = m.getByRole("button", { name: /Skip setup|Not now|Got it/ }).first();
      if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
      await shoot(m, "phones", slug, { settle: opts.settle ?? 2200 });
    }
  } finally {
    await ctx.close();
  }
}

/**
 * A believable client address on requests to our own server only. (Sending it
 * on every request, as setExtraHTTPHeaders does, makes the browser refuse
 * cross-origin web fonts — storefronts would be shot in fallback fonts.)
 */
export async function asVisitor(page: Page, address = ip()) {
  const base = process.env.CAPTURE_URL ?? "http://localhost:3000";
  await page.context().route(`${base}/**`, (r) => r.continue({ headers: { ...r.request().headers(), "x-forwarded-for": address } }));
}
