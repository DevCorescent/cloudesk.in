import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { portable } from "@/server/export/bundle";
import { crc32, zip } from "@/server/export/zip";

describe("zip", () => {
  it("makes an archive standard tools open and verify", () => {
    const big = "<p>hello</p>".repeat(500);
    const z = zip([
      { path: "index.html", data: big },
      { path: "about/index.html", data: "<h1>About — café</h1>" },
      { path: "img.bin", data: Buffer.from([0, 1, 2, 3]) },
    ]);
    const dir = mkdtempSync(join(tmpdir(), "cc-zip-"));
    const file = join(dir, "site.zip");
    writeFileSync(file, z);
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
    expect(execFileSync("unzip", ["-p", file, "about/index.html"]).toString()).toBe("<h1>About — café</h1>");
    expect(execFileSync("unzip", ["-p", file, "index.html"]).toString()).toBe(big);
    // Compressible pages are actually compressed.
    expect(z.length).toBeLessThan(big.length / 4);
  });
  it("computes CRC-32 like everyone else", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});

describe("portable pages", () => {
  it("points platform APIs and server-only pages back to the platform", () => {
    const html = `<form action="/api/v1/sites/d1/forms/contact?page=/"></form><img src="/api/v1/media/a.png"><a href="/about">About</a><a href="/shop">Shop</a><a href="/product/mug">Mug</a><a href="/cart">Cart</a><div style="background:url(/api/v1/media/b.png)"></div>`;
    const out = portable(html, "https://app.example", "https://app.example/s/acme/site");
    expect(out).toContain('action="https://app.example/api/v1/sites/d1/forms/contact?page=/"');
    expect(out).toContain('src="https://app.example/api/v1/media/a.png"');
    expect(out).toContain('href="/about"');
    expect(out).toContain('href="https://app.example/s/acme/site/shop"');
    expect(out).toContain('href="https://app.example/s/acme/site/product/mug"');
    expect(out).toContain('href="https://app.example/s/acme/site/cart"');
    expect(out).toContain("url(https://app.example/api/v1/media/b.png)");
  });
});
