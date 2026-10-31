// Roles inside the platform console. Owners can do everything, including
// settings, integrations and who else is an admin; admins run workspaces and
// users; support looks things up and helps; analysts see the numbers only.
export const PLATFORM_ROLES = ["owner", "admin", "support", "analyst"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PLATFORM_PERMS = {
  "analytics:read": ["owner", "admin", "support", "analyst"],
  "health:read": ["owner", "admin", "support", "analyst"],
  "tenants:read": ["owner", "admin", "support"],
  "tenants:write": ["owner", "admin"],
  "users:read": ["owner", "admin", "support"],
  "users:write": ["owner", "admin"],
  "audit:read": ["owner", "admin", "support"],
  "flags:write": ["owner", "admin"],
  "requests:read": ["owner", "admin", "support"],
  "requests:write": ["owner", "admin", "support"],
  "notices:write": ["owner", "admin"],
  "settings:read": ["owner", "admin"],
  "settings:write": ["owner"],
  "integrations:test": ["owner"],
  "admins:write": ["owner"],
} as const satisfies Record<string, readonly PlatformRole[]>;
export type PlatformPerm = keyof typeof PLATFORM_PERMS;

export const ROLE_LABEL: Record<PlatformRole, { name: string; what: string }> = {
  owner: { name: "Owner", what: "Everything, including settings, integrations and admins" },
  admin: { name: "Admin", what: "Workspaces, users, flags and announcements" },
  support: { name: "Support", what: "Look up workspaces, users and the audit log" },
  analyst: { name: "Analyst", what: "Analytics and health only" },
};

export const isPlatformRole = (x: unknown): x is PlatformRole => PLATFORM_ROLES.includes(x as PlatformRole);
export const platformCan = (role: string | null | undefined, perm: PlatformPerm) => isPlatformRole(role) && (PLATFORM_PERMS[perm] as readonly string[]).includes(role);
export const platformPerms = (role: string | null | undefined) => (Object.keys(PLATFORM_PERMS) as PlatformPerm[]).filter((p) => platformCan(role, p));
