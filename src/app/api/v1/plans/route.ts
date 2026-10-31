// The plans on sale and the prices for building your own (public: the site and sign-up show them).
import { publicCatalog } from "@/server/billing/subscriptions";
import { route } from "@/server/http/handler";

export const GET = route(async () => publicCatalog(), { auth: false });
