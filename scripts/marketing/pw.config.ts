// Captures the real screenshots used on the marketing site (public/marketing/).
// Runs against a local dev server with demo data it creates itself:
//   npx playwright test -c scripts/marketing/pw.config.ts <file>
import { config } from "dotenv";
import { defineConfig } from "@playwright/test";

// Demo data can be seeded straight into the dev database.
config({ path: ".env.local", quiet: true });

export default defineConfig({
  testDir: ".",
  testMatch: /capture-.*\.spec\.ts$/,
  timeout: 900_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.CAPTURE_URL ?? "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    colorScheme: "light",
  },
});
