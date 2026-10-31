import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: `npx next start -p ${PORT}`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      APP_URL: `http://localhost:${PORT}`,
      APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? "",
      ANTHROPIC_API_KEY: "",
      // Tests and helpers create accounts directly; people sign up with an emailed code.
      ALLOW_DIRECT_SIGNUP: "1",
    },
  },
});
