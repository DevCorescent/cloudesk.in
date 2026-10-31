import type { NextConfig } from "next";

// Security headers for the platform UI. Published sites are served by their
// own route handler with a stricter, script-free policy (see src/server/hosting);
// shared catalogues (/c/) set their own policy in their route.
const csp = [
  "default-src 'self'",
  // Monaco is loaded from jsDelivr by @monaco-editor/react.
  // Razorpay Checkout pays subscription invoices (Settings → Billing).
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://cdn.jsdelivr.net https://api.razorpay.com https://lumberjack.razorpay.com",
  "frame-src 'self' blob: data: https://www.google.com https://api.razorpay.com https://checkout.razorpay.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// HTTPS installs tell browsers to never use plain HTTP again (two years), on every path.
// A production build counts as HTTPS unless APP_URL says plain http:// — a missing
// APP_URL mustn't drop the header (browsers ignore it on plain HTTP anyway).
const appUrl = process.env.APP_URL ?? "";
const https = appUrl.startsWith("https://") || (process.env.NODE_ENV === "production" && !appUrl.startsWith("http://"));
const hsts = https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : [];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev-mode badge sits bottom-right, clear of the sidebar's collapse button.
  devIndicators: { position: "bottom-right" },
  // Marketing photography comes from Unsplash (free licence); ids are checked by hand.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com", pathname: "/photo-**" }],
  },
  serverExternalPackages: ["@node-rs/argon2", "pg", "quickjs-emscripten", "quickjs-emscripten-core", "@jitl/quickjs-wasmfile-release-sync"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        // Email bodies (…/mail/messages/:id/html) set their own sandboxed policy so the inbox can frame them.
        source: "/((?!sites/|s/|d/|rv/|assets/|mail-img/|c/|t/|v/|r/|u/|careers/|api/v1/orgs/[^/]+/mail/messages/[^/]+/html).*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The till scans barcodes with the camera; only the app itself may ask.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      // Every response, published sites and API answers included: never guess a content type.
      { source: "/(.*)", headers: [...hsts, { key: "X-Content-Type-Options", value: "nosniff" }] },
    ];
  },
};

export default nextConfig;
