import { revalidatePath } from "next/cache";

/**
 * The website's pages (home, pricing, legal) are built once and served from
 * the edge, refreshed every few minutes. After an admin change they show
 * (legal details, prices, plans), they're rebuilt on their next visit instead.
 */
export function refreshPublicPages() {
  try {
    revalidatePath("/", "layout");
  } catch {
    // Outside a request (tests, scripts) there's nothing cached to refresh.
  }
}
