import { describe, expect, it } from "vitest";
import { can, canAssignRole, ROLES } from "@/server/authz/permissions";
import { costMicroUsd } from "@/server/ai/catalog";
import { extractJson } from "@/server/ai/json";
import { decryptSecret, encryptSecret, secretHint } from "@/server/security/secrets";
import { normalizePath, permissionForPath } from "@/server/services/files";

describe("permissions", () => {
  it("only lets owners and admins manage secrets and members", () => {
    for (const r of ROLES) {
      expect(can(r, "secrets:manage")).toBe(r === "owner" || r === "admin");
      expect(can(r, "members:manage")).toBe(r === "owner" || r === "admin");
    }
  });
  it("keeps viewers and billing managers read-only on projects", () => {
    for (const r of ["viewer", "billing"] as const) {
      expect(can(r, "project:read")).toBe(true);
      expect(can(r, "design:write")).toBe(false);
      expect(can(r, "code:write")).toBe(false);
      expect(can(r, "deploy:preview")).toBe(false);
    }
  });
  it("lets designers edit design but not code or production", () => {
    expect(can("designer", "design:write")).toBe(true);
    expect(can("designer", "code:write")).toBe(false);
    expect(can("designer", "deploy:production")).toBe(false);
  });
  it("prevents admins from minting owners", () => {
    expect(canAssignRole("admin", "owner")).toBe(false);
    expect(canAssignRole("admin", "developer")).toBe(true);
    expect(canAssignRole("owner", "owner")).toBe(true);
    expect(canAssignRole("developer", "viewer")).toBe(false);
  });
});

describe("paths", () => {
  it("rejects traversal and odd characters", () => {
    for (const bad of ["../etc/passwd", "a/../../b", "a//b", "", "a/./b", "a b", "x\0y"]) {
      expect(() => normalizePath(bad)).toThrow();
    }
  });
  it("normalizes leading slashes and backslashes", () => {
    expect(normalizePath("/src\\app.ts")).toBe("src/app.ts");
  });
  it("maps the design document to design permission", () => {
    expect(permissionForPath("site/site.json")).toBe("design:write");
    expect(permissionForPath("src/index.ts")).toBe("code:write");
  });
});

describe("secrets", () => {
  it("encrypts with authentication", () => {
    const env = encryptSecret("sk-ant-secret-value-123");
    expect(env).not.toContain("secret");
    expect(decryptSecret(env)).toBe("sk-ant-secret-value-123");
    const tampered = env.slice(0, -2) + (env.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(tampered)).toThrow();
  });
  it("masks values", () => {
    expect(secretHint("sk-ant-1234567890abcd")).toBe("sk-a…abcd");
  });
});

describe("ai helpers", () => {
  it("extracts fenced JSON", () => {
    expect(extractJson('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("no json")).toThrow();
  });
  it("computes cost in micro-dollars", () => {
    // 1M input at $4 + 1M output at $20 = $24
    expect(costMicroUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBe(24_000_000);
  });
});
