import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ─── Identity ────────────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    /** Null for accounts that only sign in with an external provider (GitHub). */
    passwordHash: text("password_hash"),
    /** Authenticator-app secret, AES-GCM encrypted; set during setup, active once totpEnabledAt is set. */
    totpSecret: text("totp_secret"),
    totpEnabledAt: timestamp("totp_enabled_at", { withTimezone: true }),
    /** Last accepted 30-second step, so a code can't be replayed. */
    totpLastStep: integer("totp_last_step"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    /** For platform admins: owner | admin | support | analyst (null on an admin = owner). */
    platformRole: text("platform_role"),
    /** Disabled by the platform: can't sign in, and every session ends. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    disabledReason: text("disabled_reason").notNull().default(""),
    /** Answers from the welcome flow: { intent, role, experience, notifyInternal }. */
    onboarding: jsonb("onboarding"),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    /** A public handle people find you by (@kabir.shah): lowercase letters, digits, dots and underscores. */
    username: text("username"),
    /** A phone number people who already have it can find you by (never shown to them). */
    phone: text("phone").notNull().default(""),
    /** Whether people outside your workspaces can find you by username, email or phone. */
    discoverable: boolean("discoverable").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_lower_uq").on(sql`lower(${t.email})`), uniqueIndex("users_username_uq").on(sql`lower(${t.username})`).where(sql`username is not null`)],
);

// The session id stored here is a SHA-256 hash of the cookie token, so a
// database leak does not yield usable session cookies.
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the person last re-entered their password in this session (step-up for sensitive admin actions). */
    reauthAt: timestamp("reauth_at", { withTimezone: true }),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const authTokenKind = pgEnum("auth_token_kind", ["email_verify", "password_reset"]);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: authTokenKind("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash)],
);

// Development/outbound mail log. In production a mail provider adapter sends
// these; locally they are only recorded so flows can be completed by hand.
export const outboundEmails = pgTable("outbound_emails", {
  id: id(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  transport: text("transport").notNull(),
  /** recorded (outbox only) | sent | failed */
  status: text("status").notNull().default("recorded"),
  providerId: text("provider_id"),
  error: text("error"),
  createdAt: createdAt(),
});

// ─── Tenancy ─────────────────────────────────────────────────────────────────

export const orgRole = pgEnum("org_role", [
  "owner",
  "admin",
  "billing",
  "developer",
  "designer",
  "editor",
  "viewer",
  "employee",
]);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Members must turn on two-factor sign-in to use this organization. */
    requireMfa: boolean("require_mfa").notNull().default(false),
    /** Billing plan: free | pro | business. Only enforced when billing is configured. */
    plan: text("plan").notNull().default("free"),
    billingProvider: text("billing_provider"),
    billingCustomerId: text("billing_customer_id"),
    subscriptionId: text("subscription_id"),
    /** active | trialing | past_due | canceled | incomplete | halted */
    subscriptionStatus: text("subscription_status"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    billingEmail: text("billing_email"),
    /** Switched-on workspace features (see lib/workspace/modules); null = all of them. */
    modules: jsonb("modules").$type<string[]>(),
    /** Parts of switched-on modules that are off, by module id (see lib/workspace/modules). */
    partsOff: jsonb("parts_off").$type<Partial<Record<string, string[]>>>().notNull().default({}),
    /** The industry picked at onboarding. */
    industry: text("industry"),
    /** Suspended by the platform: members can't open it until it's lifted. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    suspendedReason: text("suspended_reason").notNull().default(""),
    /** With a suspension for abuse: the workspace's public sites stop serving too. */
    sitesOffline: boolean("sites_offline").notNull().default(false),
    /** A trial of a paid plan given by the platform, until this time. */
    trialPlan: text("trial_plan"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /** The owner asked for the workspace to be deleted; it's removed for good after this time unless cancelled. */
    deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
    /** A plan the platform gives without payment (partners, staff, compensation); applies while set. */
    compPlan: text("comp_plan"),
    /** Operators' private note about this workspace. */
    platformNote: text("platform_note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export const memberships = pgTable(
  "memberships",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull(),
    /** A workspace's own role: its base role's permissions, limited to some modules. */
    customRoleId: uuid("custom_role_id").references((): AnyPgColumn => customRoles.id, { onDelete: "set null" }),
    /** Data limits: the companies and branches this member may see (null: all). */
    access: jsonb("access").$type<{ companies?: string[]; branches?: string[] }>(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

/** Roles a workspace makes for itself, like "Store manager": a base role limited to chosen modules. */
export const customRoles = pgTable(
  "custom_roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    baseRole: orgRole("base_role").notNull(),
    modules: jsonb("modules").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("custom_roles_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** Invited by their Cloudesk username: the account it's for (its email stays hidden from the inviter). */
    userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_uq").on(t.tokenHash), index("invitations_org_idx").on(t.orgId), index("invitations_user_idx").on(t.userId)],
);

// ─── Business IDs ────────────────────────────────────────────────────────────

/** What a business ID shows. Every field is optional; `links` are extra buttons. */
export type BusinessCardData = {
  name?: string;
  title?: string;
  department?: string;
  company?: string;
  tagline?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  address?: string;
  bio?: string;
  links?: { label: string; url: string }[];
};
/** How it looks: a design, an accent colour and the shape of the card. */
export type BusinessCardStyle = { design?: string; accent?: string; shape?: string };

/**
 * A member's virtual business ID in a workspace: made for them the first time
 * they open it (from their account, HR record and the workspace), editable,
 * and shared at /id/<slug> with a QR code, a contact file and a form for the
 * people they meet to send their details back.
 */
export const businessCards = pgTable(
  "business_cards",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The public address: /id/<slug>. */
    slug: text("slug").notNull(),
    data: jsonb("data").$type<BusinessCardData>().notNull().default({}),
    style: jsonb("style").$type<BusinessCardStyle>().notNull().default({}),
    /** Fields hidden from the public page, by name. */
    hidden: jsonb("hidden").$type<string[]>().notNull().default([]),
    /** Off: the link shows nothing. */
    published: boolean("published").notNull().default(true),
    /** Let visitors send their own details back. */
    exchange: boolean("exchange").notNull().default(true),
    views: integer("views").notNull().default(0),
    saves: integer("saves").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("business_cards_member_uq").on(t.orgId, t.userId), uniqueIndex("business_cards_slug_uq").on(sql`lower(${t.slug})`)],
);

/**
 * A workspace's house style for business IDs: the company's own details on
 * every card, and (when locked) one design everyone uses.
 */
export const businessCardTemplates = pgTable("business_card_templates", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  style: jsonb("style").$type<BusinessCardStyle>().notNull().default({}),
  /** company, tagline, website, address: filled in on every card. */
  data: jsonb("data").$type<BusinessCardData>().notNull().default({}),
  /** Members can't change the design. */
  lockStyle: boolean("lock_style").notNull().default(false),
  /** Members can't change the company's details. */
  lockCompany: boolean("lock_company").notNull().default(true),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Details someone sent back from a business ID. */
export const businessCardExchanges = pgTable(
  "business_card_exchanges",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    cardId: uuid("card_id").notNull().references(() => businessCards.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    company: text("company").notNull().default(""),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("business_card_exchanges_card_idx").on(t.cardId, t.createdAt)],
);

// ─── Projects and files ──────────────────────────────────────────────────────

export const projectKind = pgEnum("project_kind", ["website", "landing", "portfolio", "blog", "store", "app"]);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The company and branch its sales and books belong to (null: the default company). */
    companyId: uuid("company_id"),
    branchId: uuid("branch_id"),
    slug: text("slug").notNull(),
    kind: projectKind("kind").notNull().default("website"),
    description: text("description").notNull().default(""),
    // Approved structured specification (see src/server/site/spec.ts).
    spec: jsonb("spec"),
    productionDeploymentId: uuid("production_deployment_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("projects_org_slug_uq").on(t.orgId, t.slug), index("projects_org_idx").on(t.orgId)],
);

export const fileSource = pgEnum("file_source", ["user", "ai", "template", "system", "restore"]);

// Every project artifact — the visual builder's design document included — is
// a file here. The builder, IDE, preview and deploy pipeline all read the same
// rows, which is what keeps them in sync.
export const projectFiles = pgTable(
  "project_files",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: text("content").notNull(),
    revision: integer("revision").notNull().default(1),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("project_files_path_uq").on(t.projectId, t.path)],
);

export const fileRevisions = pgTable(
  "file_revisions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    revision: integer("revision").notNull(),
    // null content records a deletion.
    content: text("content"),
    source: fileSource("source").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    aiTaskId: uuid("ai_task_id"),
    message: text("message"),
    createdAt: createdAt(),
  },
  (t) => [index("file_revisions_project_path_idx").on(t.projectId, t.path, t.revision)],
);

// ─── AI ──────────────────────────────────────────────────────────────────────

export const aiTaskStatus = pgEnum("ai_task_status", [
  "queued",
  "running",
  "awaiting_review",
  "succeeded",
  "failed",
  "cancelled",
]);

export const aiTasks = pgTable(
  "ai_tasks",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: aiTaskStatus("status").notNull().default("queued"),
    input: jsonb("input").notNull(),
    // Proposed changes / plan. Never applied until the user accepts.
    result: jsonb("result"),
    error: text("error"),
    errorCode: text("error_code"),
    provider: text("provider"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull().default(0),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    attempt: integer("attempt").notNull().default(1),
    parentTaskId: uuid("parent_task_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_tasks_project_idx").on(t.projectId, t.createdAt),
    index("ai_tasks_org_idx").on(t.orgId, t.createdAt),
    index("ai_tasks_status_idx").on(t.status),
  ],
);

export const aiTaskSteps = pgTable(
  "ai_task_steps",
  {
    id: id(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => aiTasks.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    status: text("status").notNull(),
    detail: text("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_task_steps_task_idx").on(t.taskId, t.createdAt)],
);

// Organization-supplied provider credentials, encrypted at rest.
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyHint: text("key_hint").notNull(),
    status: text("status").notNull().default("unverified"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("provider_credentials_org_provider_uq").on(t.orgId, t.provider)],
);

// ─── Deployments ─────────────────────────────────────────────────────────────

export const deploymentStatus = pgEnum("deployment_status", [
  "queued",
  "building",
  "verifying",
  "ready",
  "failed",
  "cancelled",
]);

export const deployments = pgTable(
  "deployments",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    environment: text("environment").notNull(),
    adapter: text("adapter").notNull(),
    status: deploymentStatus("status").notNull().default("queued"),
    // Map of route path → rendered HTML for the platform static host.
    artifact: jsonb("artifact"),
    sourceRevisions: jsonb("source_revisions"),
    /** Set for preview deploys of a version branch; those are never promoted. */
    branchName: text("branch_name"),
    log: jsonb("log").notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("deployments_project_idx").on(t.projectId, t.createdAt)],
);

// Contact form submissions from published sites.
export const formSubmissions = pgTable(
  "form_submissions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    deploymentId: uuid("deployment_id").references(() => deployments.id, { onDelete: "set null" }),
    formId: text("form_id").notNull(),
    data: jsonb("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("form_submissions_project_idx").on(t.projectId, t.createdAt)],
);

// ─── Audit ───────────────────────────────────────────────────────────────────

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadata: jsonb("metadata"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_logs_org_idx").on(t.orgId, t.createdAt), index("audit_logs_actor_idx").on(t.actorId)],
);

// ─── Media ───────────────────────────────────────────────────────────────────

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// Uploaded images. Stored in PostgreSQL for this single-instance deployment;
// an S3-compatible adapter can replace the `data` column later.
export const assets = pgTable(
  "assets",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("assets_project_idx").on(t.projectId, t.createdAt), uniqueIndex("assets_project_hash_uq").on(t.projectId, t.sha256)],
);

// ─── Site analytics ──────────────────────────────────────────────────────────

// Aggregated daily counters for published sites. No cookies, IP addresses or
// user agents are stored; only counts per day, path, event and A/B variant.
export const siteStats = pgTable(
  "site_stats",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    path: text("path").notNull(),
    kind: text("kind").notNull(),
    experiment: text("experiment").notNull().default(""),
    variant: text("variant").notNull().default(""),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.day, t.path, t.kind, t.experiment, t.variant] })],
);

// ─── Commerce ────────────────────────────────────────────────────────────────
// Money is stored as integers in the currency's minor unit (paise, cents).

export const stores = pgTable("stores", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  currency: text("currency").notNull().default("INR"),
  /** Extra currencies shoppers can pay in: [{ code, rate (1 base unit = rate code units), rounding }]. */
  currencies: jsonb("currencies").notNull().default(sql`'[]'::jsonb`),
  currencyRatesUpdatedAt: timestamp("currency_rates_updated_at", { withTimezone: true }),
  country: text("country").notNull().default("IN"),
  region: text("region").notNull().default(""),
  address: jsonb("address"),
  taxId: text("tax_id").notNull().default(""),
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(true),
  defaultTaxBps: integer("default_tax_bps").notNull().default(1800),
  orderPrefix: text("order_prefix").notNull().default("#"),
  nextOrderNumber: integer("next_order_number").notNull().default(1001),
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
  policies: jsonb("policies").notNull().default(sql`'{}'::jsonb`),
  checkout: jsonb("checkout").notNull().default(sql`'{}'::jsonb`),
  /** Automatic abandoned-cart recovery: { enabled, delayHours, email, whatsapp, discountCode }. */
  recovery: jsonb("recovery").notNull().default(sql`'{}'::jsonb`),
  notifyEmails: text("notify_emails").array().notNull().default(sql`'{}'::text[]`),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const storeCollections = pgTable(
  "store_collections",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    image: text("image").notNull().default(""),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("store_collections_slug_uq").on(t.projectId, t.slug)],
);

export const productStatus = pgEnum("product_status", ["draft", "active", "archived"]);

export const storeProducts = pgTable(
  "store_products",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    status: productStatus("status").notNull().default("draft"),
    images: jsonb("images").notNull().default(sql`'[]'::jsonb`),
    options: jsonb("options").notNull().default(sql`'[]'::jsonb`),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    vendor: text("vendor").notNull().default(""),
    taxBps: integer("tax_bps"),
    /** HSN (goods) or SAC (services) code for GST invoices. */
    hsn: text("hsn").notNull().default(""),
    /** physical | digital (a downloadable file) | membership (access to members-only pages) */
    kind: text("kind").notNull().default("physical"),
    /** The private file a digital product delivers (store_digital_files). */
    digitalFileId: uuid("digital_file_id"),
    /** Membership length in days; null = lifetime. */
    membershipDays: integer("membership_days"),
    /** Set for subscription products: renews every `subscriptionIntervalCount` weeks/months/years. */
    subscriptionInterval: text("subscription_interval"),
    subscriptionIntervalCount: integer("subscription_interval_count").notNull().default(1),
    featured: boolean("featured").notNull().default(false),
    isSample: boolean("is_sample").notNull().default(false),
    seoTitle: text("seo_title").notNull().default(""),
    seoDescription: text("seo_description").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("store_products_slug_uq").on(t.projectId, t.slug), index("store_products_status_idx").on(t.projectId, t.status)],
);

export const storeProductCollections = pgTable(
  "store_product_collections",
  {
    productId: uuid("product_id").notNull().references(() => storeProducts.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id").notNull().references(() => storeCollections.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.productId, t.collectionId] })],
);

export const storeVariants = pgTable(
  "store_variants",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => storeProducts.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("Default"),
    options: jsonb("options").notNull().default(sql`'{}'::jsonb`),
    sku: text("sku").notNull().default(""),
    /** EAN-13/UPC/GTIN or any code printed on the label; scanned at the POS. Unique per store when set. */
    barcode: text("barcode").notNull().default(""),
    price: integer("price").notNull(),
    compareAt: integer("compare_at"),
    cost: integer("cost"),
    trackInventory: boolean("track_inventory").notNull().default(true),
    stock: integer("stock").notNull().default(0),
    weightGrams: integer("weight_grams").notNull().default(0),
    position: integer("position").notNull().default(0),
    lowStockNotifiedAt: timestamp("low_stock_notified_at", { withTimezone: true }),
  },
  (t) => [index("store_variants_product_idx").on(t.productId), uniqueIndex("store_variants_barcode_uq").on(t.projectId, t.barcode).where(sql`${t.barcode} <> ''`)],
);

export const storeInventoryLog = pgTable(
  "store_inventory_log",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").notNull().references(() => storeVariants.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    ref: text("ref"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("store_inventory_log_variant_idx").on(t.variantId, t.createdAt)],
);

export const storeCustomers = pgTable(
  "store_customers",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    phone: text("phone").notNull().default(""),
    acceptsMarketing: boolean("accepts_marketing").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("store_customers_email_uq").on(t.projectId, sql`lower(${t.email})`)],
);

export const storeCarts = pgTable(
  "store_carts",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    /** Presentment currency chosen by the shopper; null means the store's base currency. */
    currency: text("currency"),
    email: text("email").notNull().default(""),
    address: jsonb("address"),
    shippingRateId: uuid("shipping_rate_id"),
    paymentMethod: text("payment_method"),
    discountCode: text("discount_code"),
    giftCardCode: text("gift_card_code"),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
    whatsappRemindedAt: timestamp("whatsapp_reminded_at", { withTimezone: true }),
    buyerGstin: text("buyer_gstin").notNull().default(""),
    buyerBusinessName: text("buyer_business_name").notNull().default(""),
    orderId: uuid("order_id"),
    recoveryEmailedAt: timestamp("recovery_emailed_at", { withTimezone: true }),
    /** Hash of the token in the reminder link, which restores this cart in any browser. */
    recoveryTokenHash: text("recovery_token_hash"),
    /** Set when the automatic recovery run picked up this cart (so it is sent once). */
    recoveryStartedAt: timestamp("recovery_started_at", { withTimezone: true }),
    /** When the shopper came back through a reminder link. */
    recoveredAt: timestamp("recovered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("store_carts_token_uq").on(t.tokenHash), index("store_carts_project_idx").on(t.projectId, t.updatedAt)],
);

export const financialStatus = pgEnum("financial_status", ["pending", "paid", "partially_refunded", "refunded", "voided"]);
export const fulfillmentStatus = pgEnum("fulfillment_status", ["unfulfilled", "packed", "shipped", "delivered", "returned"]);

export const storeOrders = pgTable(
  "store_orders",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    accessKeyHash: text("access_key_hash").notNull(),
    customerId: uuid("customer_id").references(() => storeCustomers.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    shippingAddress: jsonb("shipping_address").notNull(),
    currency: text("currency").notNull(),
    /** For orders in another currency: the rate used (1 base unit = rate order units) and the total in base currency. */
    exchangeRate: text("exchange_rate"),
    baseTotal: integer("base_total"),
    /** Orders created by a subscription renewal point at it (the first order owns it). */
    subscriptionId: uuid("subscription_id"),
    subtotal: integer("subtotal").notNull(),
    discountTotal: integer("discount_total").notNull().default(0),
    shippingTotal: integer("shipping_total").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    feeTotal: integer("fee_total").notNull().default(0),
    total: integer("total").notNull(),
    refundedTotal: integer("refunded_total").notNull().default(0),
    /** Paid with a gift card; not part of the amount charged by the payment method. */
    giftCardTotal: integer("gift_card_total").notNull().default(0),
    /** The customer agreed to order updates on WhatsApp at checkout. */
    whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
    /** B2B purchase: the buyer's GSTIN and registered name (printed on the invoice). */
    buyerGstin: text("buyer_gstin").notNull().default(""),
    buyerBusinessName: text("buyer_business_name").notNull().default(""),
    /** Sequential per financial year, assigned when the order is paid. */
    invoiceNumber: text("invoice_number"),
    giftCardCode: text("gift_card_code"),
    taxIncluded: boolean("tax_included").notNull(),
    discountCode: text("discount_code"),
    shippingMethod: jsonb("shipping_method"),
    paymentMethod: text("payment_method").notNull(),
    /** online: the website checkout · pos: sold at the counter. */
    channel: text("channel").notNull().default("online"),
    /** POS sale details: { method, tendered, change, staffId, staffName, register }. */
    pos: jsonb("pos"),
    paymentRef: text("payment_ref"),
    paymentCaptureRef: text("payment_capture_ref"),
    financialStatus: financialStatus("financial_status").notNull().default("pending"),
    fulfillmentStatus: fulfillmentStatus("fulfillment_status").notNull().default("unfulfilled"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    tracking: jsonb("tracking"),
    /** Courier booking made through a shipping integration (e.g. Shiprocket). */
    shipment: jsonb("shipment"),
    note: text("note").notNull().default(""),
    stockReleased: boolean("stock_released").notNull().default(false),
    reservedUntil: timestamp("reserved_until", { withTimezone: true }),
    createdAt: createdAt(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("store_orders_number_uq").on(t.projectId, t.number), index("store_orders_project_idx").on(t.projectId, t.createdAt), index("store_orders_payment_ref_idx").on(t.paymentRef)],
);

export const storeOrderItems = pgTable(
  "store_order_items",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => storeProducts.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => storeVariants.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    variantTitle: text("variant_title").notNull().default(""),
    sku: text("sku").notNull().default(""),
    image: text("image").notNull().default(""),
    unitPrice: integer("unit_price").notNull(),
    unitCost: integer("unit_cost"),
    quantity: integer("quantity").notNull(),
    taxBps: integer("tax_bps").notNull().default(0),
    hsn: text("hsn").notNull().default(""),
    kind: text("kind").notNull().default("physical"),
    downloads: integer("downloads").notNull().default(0),
    total: integer("total").notNull(),
  },
  (t) => [index("store_order_items_order_idx").on(t.orderId)],
);

export const storeOrderEvents = pgTable(
  "store_order_events",
  {
    id: id(),
    orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    data: jsonb("data"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("store_order_events_order_idx").on(t.orderId, t.createdAt)],
);

export const discountKind = pgEnum("discount_kind", ["percent", "fixed", "free_shipping"]);

export const storeDiscounts = pgTable(
  "store_discounts",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    kind: discountKind("kind").notNull(),
    value: integer("value").notNull().default(0),
    minSubtotal: integer("min_subtotal").notNull().default(0),
    usageLimit: integer("usage_limit"),
    usedCount: integer("used_count").notNull().default(0),
    oncePerCustomer: boolean("once_per_customer").notNull().default(false),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("store_discounts_code_uq").on(t.projectId, sql`lower(${t.code})`)],
);

export const storeShippingZones = pgTable("store_shipping_zones", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  countries: text("countries").array().notNull().default(sql`'{}'::text[]`),
  regions: text("regions").array().notNull().default(sql`'{}'::text[]`),
  postalPrefixes: text("postal_prefixes").array().notNull().default(sql`'{}'::text[]`),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
});

export const shippingRateKind = pgEnum("shipping_rate_kind", ["flat", "free_over", "weight", "pickup"]);

export const storeShippingRates = pgTable("store_shipping_rates", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  zoneId: uuid("zone_id").notNull().references(() => storeShippingZones.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: shippingRateKind("kind").notNull(),
  amount: integer("amount").notNull().default(0),
  freeOver: integer("free_over"),
  weightTiers: jsonb("weight_tiers").notNull().default(sql`'[]'::jsonb`),
  eta: text("eta").notNull().default(""),
  codAllowed: boolean("cod_allowed").notNull().default(true),
  sort: integer("sort").notNull().default(0),
});

export const storeTaxRates = pgTable("store_tax_rates", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  country: text("country").notNull(),
  region: text("region").notNull().default(""),
  rateBps: integer("rate_bps").notNull(),
  name: text("name").notNull().default("Tax"),
});

export const storePaymentProviders = pgTable(
  "store_payment_providers",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    mode: text("mode").notNull().default("test"),
    secrets: text("secrets"),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("not_connected"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("store_payment_providers_uq").on(t.projectId, t.provider)],
);

export const storeReviews = pgTable(
  "store_reviews",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => storeProducts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rating: integer("rating").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    verified: boolean("verified").notNull().default(false),
    status: text("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("store_reviews_product_idx").on(t.productId, t.status)],
);

export const storeWebhookEvents = pgTable(
  "store_webhook_events",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);

// ─── Commerce: gift cards, returns, integrations ─────────────────────────────

export const storeGiftCards = pgTable(
  "store_gift_cards",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    initialValue: integer("initial_value").notNull(),
    balance: integer("balance").notNull(),
    currency: text("currency").notNull(),
    recipientEmail: text("recipient_email").notNull().default(""),
    note: text("note").notNull().default(""),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    disabled: boolean("disabled").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("store_gift_cards_code_uq").on(t.projectId, sql`upper(${t.code})`)],
);

export const storeGiftCardTxns = pgTable(
  "store_gift_card_txns",
  {
    id: id(),
    giftCardId: uuid("gift_card_id").notNull().references(() => storeGiftCards.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => storeOrders.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("store_gift_card_txns_card_idx").on(t.giftCardId, t.createdAt)],
);

export const storeReturns = pgTable(
  "store_returns",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => storeOrders.id, { onDelete: "cascade" }),
    /** requested | approved | rejected | received | refunded */
    status: text("status").notNull().default("requested"),
    reason: text("reason").notNull(),
    details: text("details").notNull().default(""),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    resolution: text("resolution").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("store_returns_project_idx").on(t.projectId, t.createdAt), index("store_returns_order_idx").on(t.orderId)],
);

/** Third-party store integrations other than payments (e.g. Shiprocket). Secrets are encrypted. */
export const storeIntegrations = pgTable(
  "store_integrations",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    secrets: text("secrets"),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("not_connected"),
    lastError: text("last_error"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("store_integrations_uq").on(t.projectId, t.kind)],
);

// ─── Growth autopilot ────────────────────────────────────────────────────────

/** A/B tests proposed and tracked by the growth autopilot (manual builder tests stay on the section only). */
export const growthExperiments = pgTable(
  "growth_experiments",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sectionId: text("section_id").notNull(),
    title: text("title").notNull(),
    hypothesis: text("hypothesis").notNull().default(""),
    /** { variant?: string; props?: Record<string, unknown>; before?: {...} } */
    change: jsonb("change").notNull(),
    /** submit | cart_add | checkout | order */
    metric: text("metric").notNull(),
    /** running | won | lost | inconclusive | stopped */
    status: text("status").notNull().default("running"),
    source: text("source").notNull().default("rules"),
    opportunityKey: text("opportunity_key").notNull().default(""),
    result: jsonb("result"),
    /** What happened after the decision: applied | applied_published | kept_original | skipped (reason) */
    outcome: text("outcome").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("growth_experiments_project_idx").on(t.projectId, t.status)],
);

export const growthSettings = pgTable("growth_settings", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  /** Put a winning version into the draft design automatically. */
  autoApplyWinners: boolean("auto_apply_winners").notNull().default(true),
  /** Publish to production after applying a winner or starting a test. */
  autoPublish: boolean("auto_publish").notNull().default(false),
  /** Start the most promising test on its own when a page has no test running. */
  autoStart: boolean("auto_start").notNull().default(false),
  /** Opportunities the owner dismissed, by key. */
  dismissed: text("dismissed").array().notNull().default(sql`'{}'::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Outbound customer messages on channels other than email (WhatsApp), with delivery status. */
export const storeMessages = pgTable(
  "store_messages",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => storeOrders.id, { onDelete: "set null" }),
    channel: text("channel").notNull(),
    to: text("to").notNull(),
    /** order_confirmation | order_shipped | order_delivered | cart_reminder | test */
    event: text("event").notNull(),
    template: text("template").notNull().default(""),
    /** queued | sent | delivered | read | failed */
    status: text("status").notNull().default("queued"),
    providerId: text("provider_id"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("store_messages_project_idx").on(t.projectId, t.createdAt), index("store_messages_provider_idx").on(t.providerId)],
);

/** Brand rules every edit must respect. Kept outside the design document so edits cannot change them. */
export const brandGuardrails = pgTable("brand_guardrails", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  lockPalette: boolean("lock_palette").notNull().default(false),
  palette: jsonb("palette"),
  lockFonts: boolean("lock_fonts").notNull().default(false),
  font: text("font"),
  headingFont: text("heading_font"),
  lockLogo: boolean("lock_logo").notNull().default(false),
  logo: text("logo"),
  /** How the brand sounds, given to the AI as writing guidance. */
  voice: text("voice").notNull().default(""),
  bannedWords: text("banned_words").array().notNull().default(sql`'{}'::text[]`),
  /** [{ avoid, use }] */
  preferredTerms: jsonb("preferred_terms").notNull().default(sql`'[]'::jsonb`),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Custom domains ──────────────────────────────────────────────────────────

export const siteDomains = pgTable(
  "site_domains",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    hostname: text("hostname").notNull(),
    /** pending | verified | failed */
    status: text("status").notNull().default("pending"),
    verificationToken: text("verification_token").notNull(),
    lastError: text("last_error"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("site_domains_hostname_uq").on(t.hostname), index("site_domains_project_idx").on(t.projectId)],
);

// ─── Bookings ────────────────────────────────────────────────────────────────

export const bookingServices = pgTable(
  "booking_services",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    durationMin: integer("duration_min").notNull(),
    /** Minor units; 0 = free. */
    price: integer("price").notNull().default(0),
    /** none = pay at the visit, full = pay online when booking */
    payment: text("payment").notNull().default("none"),
    /** People per time slot (1 for appointments, more for classes). */
    capacity: integer("capacity").notNull().default(1),
    bufferMin: integer("buffer_min").notNull().default(0),
    active: boolean("active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("booking_services_project_idx").on(t.projectId)],
);

export const bookingSettings = pgTable("booking_settings", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  /** { mon: [["09:00","17:00"]], … } */
  hours: jsonb("hours").notNull(),
  slotStepMin: integer("slot_step_min").notNull().default(30),
  minNoticeHours: integer("min_notice_hours").notNull().default(2),
  maxDaysAhead: integer("max_days_ahead").notNull().default(30),
  /** Dates (YYYY-MM-DD, business time zone) with no bookings. */
  closedDates: text("closed_dates").array().notNull().default(sql`'{}'::text[]`),
  /** Hours before the start when customers may still cancel online. */
  cancelHours: integer("cancel_hours").notNull().default(24),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").references(() => bookingServices.id, { onDelete: "set null" }),
    serviceName: text("service_name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    notes: text("notes").notNull().default(""),
    /** pending_payment | confirmed | cancelled | completed | no_show */
    status: text("status").notNull(),
    amount: integer("amount").notNull().default(0),
    currency: text("currency").notNull(),
    paymentMethod: text("payment_method").notNull().default("none"),
    paymentRef: text("payment_ref"),
    paymentCaptureRef: text("payment_capture_ref"),
    paid: boolean("paid").notNull().default(false),
    accessKeyHash: text("access_key_hash").notNull(),
    holdUntil: timestamp("hold_until", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("bookings_project_start_idx").on(t.projectId, t.startsAt), index("bookings_payment_ref_idx").on(t.paymentRef)],
);

/** Invoice serial numbers per store and Indian financial year (April–March). */
export const invoiceCounters = pgTable(
  "invoice_counters",
  {
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    fy: text("fy").notNull(),
    next: integer("next").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.fy] })],
);

/** Access to members-only pages, granted by buying a membership product or by the owner. */
export const storeMemberships = pgTable(
  "store_memberships",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    orderId: uuid("order_id").references(() => storeOrders.id, { onDelete: "set null" }),
    /** null = never expires */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("store_memberships_email_idx").on(t.projectId, sql`lower(${t.email})`)],
);

/** Files sold as digital products. Never public: delivered only through an order's download link. */
export const storeDigitalFiles = pgTable(
  "store_digital_files",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("store_digital_files_project_idx").on(t.projectId)],
);

// ─── Collaboration ───────────────────────────────────────────────────────────

/** Who is in the builder right now (heartbeats; rows older than a minute are ignored). */
export const editorPresence = pgTable(
  "editor_presence",
  {
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull().default(""),
    sectionId: text("section_id").notNull().default(""),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

/** Review links let clients without an account see a preview, comment and approve. */
export const reviewLinks = pgTable(
  "review_links",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    deploymentId: uuid("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull().default(""),
    /** open | approved | changes_requested */
    status: text("status").notNull().default("open"),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("review_links_token_uq").on(t.tokenHash), index("review_links_project_idx").on(t.projectId)],
);

export const designComments = pgTable(
  "design_comments",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull().default(""),
    sectionId: text("section_id").notNull().default(""),
    parentId: uuid("parent_id"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** For client comments made through a review link. */
    guestName: text("guest_name"),
    reviewLinkId: uuid("review_link_id").references(() => reviewLinks.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("design_comments_project_idx").on(t.projectId, t.createdAt)],
);

// ─── Version branches ────────────────────────────────────────────────────────

export const siteBranches = pgTable(
  "site_branches",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** The branch's own copy of the design document. */
    content: text("content").notNull(),
    revision: integer("revision").notNull().default(1),
    /** The main document when the branch was made (or last synced): the merge base. */
    baseContent: text("base_content").notNull(),
    baseRevision: integer("base_revision").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    mergedAt: timestamp("merged_at", { withTimezone: true }),
    mergedBy: uuid("merged_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("site_branches_name_uq").on(t.projectId, t.name)],
);

// ─── Two-factor and external sign-in ─────────────────────────────────────────

export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("mfa_recovery_user_idx").on(t.userId)],
);

/** A password (or GitHub) step that still needs the second factor. */
export const mfaChallenges = pgTable("mfa_challenges", {
  id: text("id").primaryKey(), // sha256 of the token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  method: text("method").notNull(), // password | github
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    login: text("login").notNull().default(""),
    email: text("email"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_provider_user_uq").on(t.provider, t.providerUserId), uniqueIndex("oauth_user_provider_uq").on(t.userId, t.provider)],
);

// ─── Durable jobs ────────────────────────────────────────────────────────────

/**
 * A Postgres-backed job queue. Workers claim rows with FOR UPDATE SKIP LOCKED,
 * so several app instances can share it safely.
 * status: queued | running | succeeded | failed (will retry) | dead | cancelled
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(100),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    result: jsonb("result"),
    /** At most one live job per key (e.g. one scheduled run per minute). */
    dedupeKey: text("dedupe_key"),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("jobs_ready_idx").on(t.status, t.runAt, t.priority), uniqueIndex("jobs_dedupe_uq").on(t.dedupeKey), index("jobs_project_idx").on(t.projectId, t.createdAt)],
);

// ─── Workflow automation ─────────────────────────────────────────────────────

export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** { type, config }: form_submitted | order_placed | order_paid | booking_confirmed | schedule | webhook | manual */
    trigger: jsonb("trigger").notNull(),
    /** [{ id, type, config }] */
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    webhookTokenHash: text("webhook_token_hash"),
    /** JSON map of secret values, AES-GCM encrypted; referenced as {{secrets.name}}. */
    secretsEnc: text("secrets_enc"),
    /** Last minute a schedule fired, so it never fires twice. */
    lastScheduledAt: timestamp("last_scheduled_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflows_project_idx").on(t.projectId), uniqueIndex("workflows_webhook_uq").on(t.webhookTokenHash)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: id(),
    workflowId: uuid("workflow_id").notNull().references(() => workflows.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** running | waiting | succeeded | failed | stopped */
    status: text("status").notNull().default("running"),
    triggerType: text("trigger_type").notNull(),
    input: jsonb("input").notNull().default(sql`'{}'::jsonb`),
    /** Per-step log: [{ id, type, status, output, error, startedAt, finishedAt, attempts }] */
    log: jsonb("log").notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    /** The workflow as it was when this run started, so edits don't change runs in flight. */
    snapshot: jsonb("snapshot").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("workflow_runs_wf_idx").on(t.workflowId, t.startedAt), index("workflow_runs_project_idx").on(t.projectId, t.startedAt)],
);

// ─── Public API, webhooks, integrations and apps ─────────────────────────────

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** First characters, shown so people can tell keys apart. */
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
    /** Set when the key belongs to an installed app. */
    appInstallId: uuid("app_install_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_project_idx").on(t.projectId)],
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    description: text("description").notNull().default(""),
    events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
    /** Signing secret, AES-GCM encrypted. */
    secretEnc: text("secret_enc").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    appInstallId: uuid("app_install_id"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_endpoints_project_idx").on(t.projectId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    /** pending | succeeded | failed (retrying) | dead */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    error: text("error"),
    createdAt: createdAt(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt)],
);

/** Built-in integrations connected to a project (Slack, Discord, Telegram, Mailchimp). */
export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** Non-secret settings (which events, list id …). */
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    /** Credentials, AES-GCM encrypted JSON. */
    credsEnc: text("creds_enc").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    lastError: text("last_error"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("integrations_project_kind_uq").on(t.projectId, t.kind)],
);

/** Third-party apps registered by an organization (the plugin SDK). */
export const apps = pgTable(
  "apps",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    manifest: jsonb("manifest").notNull(),
    /** Used to sign install hand-offs and app webhooks; AES-GCM encrypted. */
    secretEnc: text("secret_enc").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("apps_org_slug_uq").on(t.orgId, t.slug)],
);

export const appInstalls = pgTable(
  "app_installs",
  {
    id: id(),
    appId: uuid("app_id").notNull().references(() => apps.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    scopes: jsonb("scopes").notNull(),
    config: jsonb("config").notNull().default(sql`'{}'::jsonb`),
    /** installed | handoff_failed */
    status: text("status").notNull().default("installed"),
    handoffError: text("handoff_error"),
    installedBy: uuid("installed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("app_installs_uq").on(t.appId, t.projectId)],
);

// ─── Platform billing ────────────────────────────────────────────────────────

/** Provider events, recorded once (idempotency) and shown as billing history. */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    /** For charges and invoices: amount in minor units. */
    amount: integer("amount"),
    currency: text("currency"),
    status: text("status"),
    invoiceUrl: text("invoice_url"),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("billing_events_provider_event_uq").on(t.provider, t.eventId), index("billing_events_org_idx").on(t.orgId, t.createdAt)],
);

// ─── Customer subscriptions ──────────────────────────────────────────────────

export const storeSubscriptions = pgTable(
  "store_subscriptions",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    firstOrderId: uuid("first_order_id").notNull(),
    email: text("email").notNull(),
    title: text("title").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    interval: text("interval").notNull(),
    intervalCount: integer("interval_count").notNull().default(1),
    provider: text("provider").notNull(),
    providerSubId: text("provider_sub_id").notNull(),
    /** active | past_due | canceled | incomplete */
    status: text("status").notNull().default("incomplete"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    renewals: integer("renewals").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("store_subscriptions_provider_uq").on(t.provider, t.providerSubId), index("store_subscriptions_project_idx").on(t.projectId, t.createdAt)],
);

// ─── Knowledge base and chatbot ──────────────────────────────────────────────

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Where knowledge comes from: the site, products, policies, pasted text or a web page. */
export const kbSources = pgTable(
  "kb_sources",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** site | products | policies | text | url */
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    url: text("url"),
    /** For text sources: the text itself. */
    content: text("content"),
    /** ready | indexing | error */
    status: text("status").notNull().default("indexing"),
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("kb_sources_project_idx").on(t.projectId)],
);

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: id(),
    sourceId: uuid("source_id").notNull().references(() => kbSources.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Link shown with answers (a site path or an external URL). */
    url: text("url"),
    text: text("text").notNull(),
    position: integer("position").notNull().default(0),
    /** Optional semantic vector (Voyage) when an embeddings key is configured. */
    embedding: real("embedding").array(),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', coalesce(title, '') || ' ' || text)`),
  },
  (t) => [index("kb_chunks_project_idx").on(t.projectId), index("kb_chunks_tsv_idx").using("gin", t.tsv), index("kb_chunks_trgm_idx").using("gin", sql`${t.text} gin_trgm_ops`)],
);

export const chatbots = pgTable("chatbots", {
  projectId: uuid("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  name: text("name").notNull().default("Assistant"),
  greeting: text("greeting").notNull().default("Hi! Ask me anything about us — opening hours, products, delivery, bookings."),
  /** Extra guidance from the owner (tone, what to recommend, what not to discuss). */
  instructions: text("instructions").notNull().default(""),
  /** Where "talk to a person" requests go. */
  handoffEmail: text("handoff_email").notNull().default(""),
  showLauncher: boolean("show_launcher").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    visitorHash: text("visitor_hash").notNull(),
    /** open | needs_reply | closed */
    status: text("status").notNull().default("open"),
    email: text("email"),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("chat_conversations_visitor_uq").on(t.visitorHash), index("chat_conversations_project_idx").on(t.projectId, t.updatedAt)],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
    /** user | assistant | staff */
    role: text("role").notNull(),
    text: text("text").notNull(),
    /** ai | search | none: how an assistant answer was produced. */
    mode: text("mode"),
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

// ---------- Terminal / code execution ----------

export const execRuns = pgTable(
  "exec_runs",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    command: text("command").notNull(),
    /** builtin | quickjs | docker */
    runtime: text("runtime").notNull(),
    exitCode: integer("exit_code").notNull(),
    /** [{ stream: "out" | "err" | "info", text }], truncated to the output limit. */
    output: jsonb("output").notNull().default(sql`'[]'::jsonb`),
    changedPaths: jsonb("changed_paths").notNull().default(sql`'[]'::jsonb`),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("exec_runs_project_idx").on(t.projectId, t.createdAt)],
);

// ---------- Data tables (database studio + generated API) ----------

export const dataTables = pgTable(
  "data_tables",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** URL key for the API: /api/public/v1/data/<slug>. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    fields: jsonb("fields").notNull().default(sql`'[]'::jsonb`),
    /** Anyone may list/read rows (no key), e.g. for a public directory. */
    publicRead: boolean("public_read").notNull().default(false),
    /** Anyone may add rows (no key), rate-limited, e.g. a waitlist. */
    publicInsert: boolean("public_insert").notNull().default(false),
    rowCount: integer("row_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("data_tables_slug_uq").on(t.projectId, t.slug)],
);

export const dataRows = pgTable(
  "data_rows",
  {
    id: id(),
    tableId: uuid("table_id").notNull().references(() => dataTables.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** { fieldId: value } */
    data: jsonb("data").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("data_rows_table_idx").on(t.tableId, t.createdAt), index("data_rows_data_gin").using("gin", t.data)],
);

// ---------- Real-time co-editing (Yjs updates relayed through Postgres) ----------

/** One shared document per open file; reset when the file changes outside co-editing. */
export const codocs = pgTable(
  "codocs",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    /** File revision the shared document started from (or was last saved as). */
    baseRevision: integer("base_revision").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("codocs_path_uq").on(t.projectId, t.path)],
);

export const codocUpdates = pgTable(
  "codoc_updates",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    docId: uuid("doc_id").notNull().references(() => codocs.id, { onDelete: "cascade" }),
    /** doc: a Yjs update; awareness: cursor/selection state (pruned quickly). */
    kind: text("kind").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id"),
    update: bytea("update").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("codoc_updates_doc_idx").on(t.docId, t.seq)],
);

// ---------- Live payment tests (provider sandbox, confirmed by signed webhook) ----------

export const paymentTests = pgTable(
  "payment_tests",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** created → (checkout) → passed (signed webhook, right amount) | failed | expired; refunded after passing. */
    status: text("status").notNull().default("created"),
    ref: text("ref"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    checks: jsonb("checks").notNull().default(sql`'[]'::jsonb`),
    webhookEventId: text("webhook_event_id"),
    captureRef: text("capture_ref"),
    providerSaysPaid: boolean("provider_says_paid"),
    error: text("error"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    webhookAt: timestamp("webhook_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
  },
  (t) => [index("payment_tests_project_idx").on(t.projectId, t.createdAt), index("payment_tests_ref_idx").on(t.ref)],
);

// ---------- Invoicing: invoices, quotations, proforma, credit notes ----------

/** A standalone set of books (a business's own finances), outside any project. */
export const financeBooks = pgTable(
  "finance_books",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    companyId: uuid("company_id"),
    branchId: uuid("branch_id"),
    /** A store whose sales appear alongside this book's invoices. */
    linkedProjectId: uuid("linked_project_id").references(() => projects.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("finance_books_org_idx").on(t.orgId)],
);

/** Logos and signatures uploaded to a finance book (shown on client-facing documents). */
export const financeFiles = pgTable("finance_files", {
  id: id(),
  bookId: uuid("book_id").notNull().references(() => financeBooks.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  data: bytea("data").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/**
 * Who owns invoicing data: a project (id = the project's id) or a finance
 * book (id = the book's id). Invoice tables point here, so deleting either
 * removes its books cleanly.
 */
export const invoiceOwners = pgTable("invoice_owners", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  bookId: uuid("book_id").references(() => financeBooks.id, { onDelete: "cascade" }),
});

export const invoiceSettings = pgTable("invoice_settings", {
  projectId: uuid("project_id").primaryKey().references(() => invoiceOwners.id, { onDelete: "cascade" }),
  /** See settingsSchema in lib/invoicing/model. */
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceTemplates = pgTable(
  "invoice_templates",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => invoiceOwners.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** templateConfigSchema */
    config: jsonb("config").notNull(),
    /** prebuilt | custom | uploaded */
    source: text("source").notNull().default("custom"),
    basedOn: text("based_on").notNull().default(""),
    /** The owner's own invoice they uploaded to match (image or PDF, ≤ 5 MB). */
    referenceMime: text("reference_mime"),
    referenceName: text("reference_name"),
    referenceData: bytea("reference_data"),
    /** What was read from the uploaded file, shown so the owner can check it. */
    extracted: jsonb("extracted"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoice_templates_project_idx").on(t.projectId)],
);

export const invoiceClients = pgTable(
  "invoice_clients",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => invoiceOwners.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    company: text("company").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    gstin: text("gstin").notNull().default(""),
    billing: jsonb("billing").notNull(),
    shipping: jsonb("shipping"),
    notes: text("notes").notNull().default(""),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_clients_project_idx").on(t.projectId)],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => invoiceOwners.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    hsn: text("hsn").notNull().default(""),
    unit: text("unit").notNull().default(""),
    rate: integer("rate").notNull().default(0),
    taxBps: integer("tax_bps").notNull().default(0),
    /** Stock that invoicing this item takes out of Inventory. */
    invItemId: uuid("inv_item_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_items_project_idx").on(t.projectId)],
);

export const invoiceDocuments = pgTable(
  "invoice_documents",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => invoiceOwners.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    /** Empty while a draft has no number yet. */
    number: text("number").notNull().default(""),
    /** draft | sent | viewed | accepted | declined | converted | partial | paid | void */
    status: text("status").notNull().default("draft"),
    clientId: uuid("client_id").references(() => invoiceClients.id, { onDelete: "set null" }),
    client: jsonb("client").notNull(),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    currency: text("currency").notNull(),
    lines: jsonb("lines").notNull(),
    adjustments: jsonb("adjustments").notNull(),
    taxMode: text("tax_mode").notNull(),
    inclusive: boolean("inclusive").notNull().default(false),
    placeOfSupply: text("place_of_supply").notNull().default(""),
    title: text("title").notNull().default(""),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    terms: text("terms").notNull().default(""),
    footer: text("footer").notNull().default(""),
    customFields: jsonb("custom_fields").notNull().default(sql`'[]'::jsonb`),
    templateId: uuid("template_id").references(() => invoiceTemplates.id, { onDelete: "set null" }),
    subtotal: integer("subtotal").notNull().default(0),
    discountTotal: integer("discount_total").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    total: integer("total").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    /** Tax by rate as printed: [{ label, rateBps, taxable, amount }] */
    taxes: jsonb("taxes").notNull().default(sql`'[]'::jsonb`),
    /** For a foreign-currency invoice: rupees per unit to post it at; empty uses the workspace rate on the issue date. */
    fxRate: numeric("fx_rate", { precision: 18, scale: 6 }),
    shareToken: text("share_token").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    viewCount: integer("view_count").notNull().default(0),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decisionNote: text("decision_note"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    /** The quote this invoice came from, or the invoice a credit note reverses. */
    sourceId: uuid("source_id"),
    recurring: jsonb("recurring"),
    lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invoice_documents_project_idx").on(t.projectId, t.type, t.issueDate),
    uniqueIndex("invoice_documents_number_uq").on(t.projectId, t.type, t.number).where(sql`${t.number} <> ''`),
    uniqueIndex("invoice_documents_token_uq").on(t.shareToken),
  ],
);

export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: id(),
    projectId: uuid("project_id").notNull().references(() => invoiceOwners.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => invoiceDocuments.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    method: text("method").notNull(),
    paidOn: date("paid_on").notNull(),
    reference: text("reference").notNull().default(""),
    note: text("note").notNull().default(""),
    /** The bank or cash account it went into (from a receipt in Accounts); null uses the default. */
    accountId: uuid("account_id"),
    /** The receipt in Accounts it was part of. */
    receiptId: uuid("receipt_id"),
    /** For a foreign-currency invoice: the rupees actually received (paise); empty uses the rate on the day. */
    inrAmount: bigint("inr_amount", { mode: "number" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_payments_doc_idx").on(t.documentId), index("invoice_payments_project_idx").on(t.projectId, t.paidOn)],
);

export const invoiceEvents = pgTable(
  "invoice_events",
  {
    id: id(),
    documentId: uuid("document_id").notNull().references(() => invoiceDocuments.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_events_doc_idx").on(t.documentId, t.createdAt)],
);

// ─── Promotions: pop-ups, bars, floating buttons and cart upsells ───────────

export const promotions = pgTable(
  "promotions",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** bar | popup | floating | shipping_goal | cart_upsell */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** Kind-specific settings, validated by lib/promotions/model.ts. */
    config: jsonb("config").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("promotions_project_idx").on(t.projectId)],
);

/** Daily counts per promotion, from the published site only. */
export const promotionStats = pgTable(
  "promotion_stats",
  {
    promotionId: uuid("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    views: integer("views").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    submits: integer("submits").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.promotionId, t.day] })],
);

/**
 * Product catalogues: shareable, printable selections of a store's products.
 * They hold rules, not copies — prices, stock and photos are read live from
 * the products every time a catalogue is opened.
 */
export const storeCatalogues = pgTable(
  "store_catalogues",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Unguessable public code: the catalogue lives at /c/<token>. */
    token: text("token").notNull(),
    /** Which products: validated by lib/store/catalogue.ts. */
    source: jsonb("source").notNull(),
    design: jsonb("design").notNull(),
    ordering: jsonb("ordering").notNull(),
    published: boolean("published").notNull().default(true),
    /** Goes live at this time (optional), and ends at expiresAt (optional). */
    startsAt: timestamp("starts_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Private catalogues: a hash of the access code buyers must enter. */
    accessCodeHash: text("access_code_hash"),
    /** Other websites may show this catalogue in a frame. */
    allowEmbed: boolean("allow_embed").notNull().default(false),
    /** Units ordered from this catalogue, by product id. */
    productOrders: jsonb("product_orders").notNull().default({}),
    /** manual | import */
    origin: text("origin").notNull().default("manual"),
    views: integer("views").notNull().default(0),
    orderClicks: integer("order_clicks").notNull().default(0),
    /** Times shared, by channel. */
    shares: jsonb("shares").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("store_catalogues_token_uq").on(t.token), index("store_catalogues_project_idx").on(t.projectId)],
);

/** Daily views and order starts per catalogue, by where the visitor came from. */
export const storeCatalogueStats = pgTable(
  "store_catalogue_stats",
  {
    catalogueId: uuid("catalogue_id")
      .notNull()
      .references(() => storeCatalogues.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    /** direct | whatsapp | qr | email | sms | pdf | social … */
    source: text("source").notNull(),
    views: integer("views").notNull().default(0),
    orders: integer("orders").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.catalogueId, t.day, t.source] })],
);

// ─── Cloudesk for Horeca: restaurants, cafés, bars and hotels ───────────────

/** One venue per project: its taxes, counters and every QR-menu / service setting. */
export const horecaVenues = pgTable("horeca_venues", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** restaurant | cafe | bar | hotel | cloud_kitchen */
  kind: text("kind").notNull().default("restaurant"),
  currency: text("currency").notNull().default("INR"),
  /** Default GST on food and drinks, in basis points (5% = 500). */
  taxBps: integer("tax_bps").notNull().default(500),
  serviceChargeBps: integer("service_charge_bps").notNull().default(0),
  /** Public code for the venue's guest pages (valet booking). */
  token: text("token").notNull(),
  /** QR menu, kitchen, rooms and valet settings; validated by lib/horeca/model.ts. */
  settings: jsonb("settings").notNull().default({}),
  nextOrderNo: integer("next_order_no").notNull().default(1),
  nextKotNo: integer("next_kot_no").notNull().default(1),
  nextValetNo: integer("next_valet_no").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("horeca_venues_token_uq").on(t.token)]);

export const horecaAreas = pgTable("horeca_areas", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("horeca_areas_project_idx").on(t.projectId)]);

/** Tables (and room-service points): each has its own QR code. */
export const horecaTables = pgTable("horeca_tables", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  areaId: uuid("area_id").references(() => horecaAreas.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  seats: integer("seats").notNull().default(4),
  /** table | room | counter */
  kind: text("kind").notNull().default("table"),
  token: text("token").notNull(),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, (t) => [uniqueIndex("horeca_tables_token_uq").on(t.token), index("horeca_tables_project_idx").on(t.projectId)]);

export const horecaCategories = pgTable("horeca_categories", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Which ticket printer / screen: kitchen | bar | dessert … */
  station: text("station").notNull().default("kitchen"),
  /** Served between these times (HH:MM, venue time); empty = all day. */
  availableFrom: text("available_from").notNull().default(""),
  availableTo: text("available_to").notNull().default(""),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("horeca_categories_project_idx").on(t.projectId)]);

export const horecaModifierGroups = pgTable("horeca_modifier_groups", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  minSelect: integer("min_select").notNull().default(0),
  maxSelect: integer("max_select").notNull().default(1),
  /** [{ id, name, price }] */
  options: jsonb("options").notNull().default([]),
}, (t) => [index("horeca_modifiers_project_idx").on(t.projectId)]);

export const horecaItems = pgTable("horeca_items", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => horecaCategories.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  price: integer("price").notNull(),
  image: text("image").notNull().default(""),
  /** veg | nonveg | egg | vegan | none */
  diet: text("diet").notNull().default("veg"),
  spice: integer("spice").notNull().default(0),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  /** Off when it's "86'd" (run out for now). */
  available: boolean("available").notNull().default(true),
  prepMinutes: integer("prep_minutes").notNull().default(15),
  /** Overrides the venue's GST rate when set. */
  taxBps: integer("tax_bps"),
  modifierGroupIds: jsonb("modifier_group_ids").notNull().default([]),
  /** Drinks: the bottle it pours from, and how much per serve. */
  barItemId: uuid("bar_item_id"),
  pourMl: integer("pour_ml"),
  /** Ingredients used per serve: [{ stockItemId, qty }]. */
  recipe: jsonb("recipe").notNull().default([]),
  /** A short code for fast POS entry. */
  code: text("code").notNull().default(""),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("horeca_items_project_idx").on(t.projectId)]);

export const horecaOrders = pgTable("horeca_orders", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  tableId: uuid("table_id").references(() => horecaTables.id, { onDelete: "set null" }),
  roomBookingId: uuid("room_booking_id"),
  /** qr | staff | takeaway | room */
  source: text("source").notNull().default("staff"),
  /** open | billed | paid | cancelled */
  status: text("status").notNull().default("open"),
  guestName: text("guest_name").notNull().default(""),
  guestPhone: text("guest_phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  /** Lets the guest who placed it follow it. */
  accessKeyHash: text("access_key_hash"),
  discount: integer("discount").notNull().default(0),
  serviceChargeBps: integer("service_charge_bps").notNull().default(0),
  tip: integer("tip").notNull().default(0),
  /** People at the table. */
  covers: integer("covers").notNull().default(0),
  guestId: uuid("guest_id"),
  /** Who opened it (staff name), for reports. */
  staffName: text("staff_name").notNull().default(""),
  deliveryAddress: text("delivery_address").notNull().default(""),
  deliveryFee: integer("delivery_fee").notNull().default(0),
  /** Points this bill earned (credited once, when it's paid). */
  pointsEarned: integer("points_earned").notNull().default(0),
  cancelReason: text("cancel_reason").notNull().default(""),
  /** [{ method, amount, at, ref?, staff?, shiftId? }] */
  payments: jsonb("payments").notNull().default([]),
  createdAt: createdAt(),
  billedAt: timestamp("billed_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [uniqueIndex("horeca_orders_number_uq").on(t.projectId, t.number), index("horeca_orders_project_idx").on(t.projectId, t.status)]);

export const horecaOrderItems = pgTable("horeca_order_items", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => horecaOrders.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  itemId: uuid("item_id"),
  name: text("name").notNull(),
  qty: integer("qty").notNull(),
  unitPrice: integer("unit_price").notNull(),
  /** [{ group, name, price }] */
  modifiers: jsonb("modifiers").notNull().default([]),
  notes: text("notes").notNull().default(""),
  station: text("station").notNull().default("kitchen"),
  /** pending (awaiting approval) | new | preparing | ready | served | void */
  status: text("status").notNull().default("new"),
  kotNo: integer("kot_no"),
  taxBps: integer("tax_bps").notNull().default(0),
  barItemId: uuid("bar_item_id"),
  pourMl: integer("pour_ml"),
  /** On the house: shown on the bill at no charge. */
  comp: boolean("comp").notNull().default(false),
  voidReason: text("void_reason").notNull().default(""),
  staffName: text("staff_name").notNull().default(""),
  /** The recipe deducted when it was fired, so a void puts back exactly that. */
  recipe: jsonb("recipe").notNull().default([]),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("horeca_order_items_order_idx").on(t.orderId), index("horeca_order_items_project_idx").on(t.projectId, t.status)]);

/** "Call waiter", "Bring the bill", "Water please" from the table's QR menu. */
export const horecaRequests = pgTable("horeca_requests", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  tableId: uuid("table_id").notNull().references(() => horecaTables.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: createdAt(),
  doneAt: timestamp("done_at", { withTimezone: true }),
}, (t) => [index("horeca_requests_project_idx").on(t.projectId, t.status)]);

export const horecaRoomTypes = pgTable("horeca_room_types", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Per night, in minor units. */
  rate: integer("rate").notNull(),
  maxGuests: integer("max_guests").notNull().default(2),
  amenities: text("amenities").array().notNull().default(sql`'{}'::text[]`),
  image: text("image").notNull().default(""),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("horeca_room_types_project_idx").on(t.projectId)]);

export const horecaRooms = pgTable("horeca_rooms", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  typeId: uuid("type_id").notNull().references(() => horecaRoomTypes.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  floor: text("floor").notNull().default(""),
  /** clean | dirty | inspect | out_of_order */
  housekeeping: text("housekeeping").notNull().default("clean"),
  /** The room's in-room dining QR. */
  tableId: uuid("table_id").references(() => horecaTables.id, { onDelete: "set null" }),
}, (t) => [uniqueIndex("horeca_rooms_number_uq").on(t.projectId, t.number)]);

export const horecaRoomBookings = pgTable("horeca_room_bookings", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").notNull().references(() => horecaRooms.id, { onDelete: "cascade" }),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone").notNull().default(""),
  guestEmail: text("guest_email").notNull().default(""),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  adults: integer("adults").notNull().default(2),
  children: integer("children").notNull().default(0),
  /** Agreed rate per night. */
  rate: integer("rate").notNull(),
  /** reserved | checked_in | checked_out | cancelled | no_show */
  status: text("status").notNull().default("reserved"),
  /** direct | walk_in | phone | ota | corporate */
  source: text("source").notNull().default("direct"),
  notes: text("notes").notNull().default(""),
  /** Extra folio charges: [{ id, label, amount, at, orderId? }] */
  charges: jsonb("charges").notNull().default([]),
  payments: jsonb("payments").notNull().default([]),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("horeca_room_bookings_project_idx").on(t.projectId, t.checkIn)]);

/** Bar stock, tracked in millilitres. */
export const horecaBarItems = pgTable("horeca_bar_items", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** whisky | vodka | gin | rum | tequila | wine | beer | liqueur | mixer | other */
  category: text("category").notNull().default("other"),
  bottleMl: integer("bottle_ml").notNull().default(750),
  costPerBottle: integer("cost_per_bottle").notNull().default(0),
  stockMl: integer("stock_ml").notNull().default(0),
  /** Warn when stock falls below this. */
  reorderMl: integer("reorder_ml").notNull().default(750),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("horeca_bar_items_project_idx").on(t.projectId)]);

export const horecaBarMoves = pgTable("horeca_bar_moves", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  barItemId: uuid("bar_item_id").notNull().references(() => horecaBarItems.id, { onDelete: "cascade" }),
  /** purchase | sale | void | wastage | adjust */
  kind: text("kind").notNull(),
  /** Signed: + in, − out. */
  ml: integer("ml").notNull(),
  note: text("note").notNull().default(""),
  orderItemId: uuid("order_item_id"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("horeca_bar_moves_item_idx").on(t.barItemId, t.createdAt)]);

/** A physical stock count, compared with what the system expected. */
export const horecaBarCounts = pgTable("horeca_bar_counts", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** [{ barItemId, name, expectedMl, countedMl, costPerMl }] */
  lines: jsonb("lines").notNull(),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("horeca_bar_counts_project_idx").on(t.projectId, t.createdAt)]);

export const horecaValet = pgTable("horeca_valet", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ticket: integer("ticket").notNull(),
  /** The guest's link to follow and request their car. */
  token: text("token").notNull(),
  /** booked | parked | requested | ready | delivered | cancelled */
  status: text("status").notNull().default("parked"),
  plate: text("plate").notNull().default(""),
  car: text("car").notNull().default(""),
  color: text("color").notNull().default(""),
  guestName: text("guest_name").notNull().default(""),
  guestPhone: text("guest_phone").notNull().default(""),
  slot: text("slot").notNull().default(""),
  keyTag: text("key_tag").notNull().default(""),
  notes: text("notes").notNull().default(""),
  tableId: uuid("table_id").references(() => horecaTables.id, { onDelete: "set null" }),
  roomBookingId: uuid("room_booking_id").references(() => horecaRoomBookings.id, { onDelete: "set null" }),
  /** For pre-booked valet: when the guest expects to arrive. */
  expectedAt: timestamp("expected_at", { withTimezone: true }),
  parkedAt: timestamp("parked_at", { withTimezone: true }),
  requestedAt: timestamp("requested_at", { withTimezone: true }),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("horeca_valet_token_uq").on(t.token), uniqueIndex("horeca_valet_ticket_uq").on(t.projectId, t.ticket), index("horeca_valet_project_idx").on(t.projectId, t.status)]);

/** People who work the floor, kitchen and desk: they unlock the POS with a PIN. */
export const horecaStaff = pgTable("horeca_staff", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** owner | manager | cashier | waiter | captain | chef | bartender | host | housekeeping | valet */
  role: text("role").notNull().default("waiter"),
  /** Argon2 hash of a 4–6 digit PIN. */
  pinHash: text("pin_hash").notNull(),
  active: boolean("active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("horeca_staff_project_idx").on(t.projectId)]);

/** A till session: opening float to closing count. */
export const horecaShifts = pgTable("horeca_shifts", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** open | closed */
  status: text("status").notNull().default("open"),
  openedBy: text("opened_by").notNull().default(""),
  openingFloat: integer("opening_float").notNull().default(0),
  openedAt: createdAt(),
  closedBy: text("closed_by").notNull().default(""),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  expectedCash: integer("expected_cash"),
  countedCash: integer("counted_cash"),
  note: text("note").notNull().default(""),
}, (t) => [index("horeca_shifts_project_idx").on(t.projectId, t.status)]);

export const horecaCashMoves = pgTable("horeca_cash_moves", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  shiftId: uuid("shift_id").notNull().references(() => horecaShifts.id, { onDelete: "cascade" }),
  /** pay_in | pay_out */
  kind: text("kind").notNull(),
  amount: integer("amount").notNull(),
  reason: text("reason").notNull().default(""),
  staffName: text("staff_name").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("horeca_cash_moves_shift_idx").on(t.shiftId)]);

/** Voids, discounts, comps, transfers, refunds and approvals — for loss prevention. */
export const horecaEvents = pgTable("horeca_events", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  orderId: uuid("order_id"),
  staffName: text("staff_name").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""),
  amount: integer("amount").notNull().default(0),
  detail: text("detail").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("horeca_events_project_idx").on(t.projectId, t.createdAt)]);

/** Table reservations and the walk-in waitlist. */
export const horecaReservations = pgTable("horeca_reservations", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** reservation | waitlist */
  kind: text("kind").notNull().default("reservation"),
  guestName: text("guest_name").notNull(),
  guestPhone: text("guest_phone").notNull().default(""),
  partySize: integer("party_size").notNull().default(2),
  at: timestamp("at", { withTimezone: true }).notNull(),
  durationMin: integer("duration_min").notNull().default(90),
  tableId: uuid("table_id").references(() => horecaTables.id, { onDelete: "set null" }),
  /** booked | confirmed | seated | completed | cancelled | no_show */
  status: text("status").notNull().default("booked"),
  /** staff | online | phone | walk_in */
  source: text("source").notNull().default("staff"),
  notes: text("notes").notNull().default(""),
  orderId: uuid("order_id"),
  createdAt: createdAt(),
}, (t) => [index("horeca_reservations_project_idx").on(t.projectId, t.at)]);

export const horecaSuppliers = pgTable("horeca_suppliers", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("horeca_suppliers_project_idx").on(t.projectId)]);

/** Kitchen ingredients and supplies, in grams, millilitres or pieces. */
export const horecaStockItems = pgTable("horeca_stock_items", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull().default("other"),
  /** g | ml | pcs */
  unit: text("unit").notNull().default("g"),
  /** How much one bought pack holds, in the unit (e.g. 1000 g). */
  packSize: integer("pack_size").notNull().default(1000),
  costPerPack: integer("cost_per_pack").notNull().default(0),
  stock: integer("stock").notNull().default(0),
  reorderAt: integer("reorder_at").notNull().default(0),
  supplierId: uuid("supplier_id").references(() => horecaSuppliers.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("horeca_stock_items_project_idx").on(t.projectId)]);

export const horecaPurchases = pgTable("horeca_purchases", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id").references(() => horecaSuppliers.id, { onDelete: "set null" }),
  invoiceNo: text("invoice_no").notNull().default(""),
  date: date("date").notNull(),
  /** [{ stockItemId, name, qty, cost }] — qty in the item's unit, cost in minor units */
  lines: jsonb("lines").notNull().default([]),
  total: integer("total").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [index("horeca_purchases_project_idx").on(t.projectId, t.date)]);

/** purchase | sale | void | wastage | adjust */
export const horecaStockMoves = pgTable("horeca_stock_moves", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stockItemId: uuid("stock_item_id").notNull().references(() => horecaStockItems.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  qty: integer("qty").notNull(),
  note: text("note").notNull().default(""),
  orderItemId: uuid("order_item_id"),
  purchaseId: uuid("purchase_id"),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [index("horeca_stock_moves_item_idx").on(t.stockItemId, t.createdAt)]);

export const horecaStockCounts = pgTable("horeca_stock_counts", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  lines: jsonb("lines").notNull().default([]),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
}, (t) => [index("horeca_stock_counts_project_idx").on(t.projectId, t.createdAt)]);

/** Regulars: visits, spend and loyalty points, found by phone number. */
export const horecaGuests = pgTable("horeca_guests", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  phone: text("phone").notNull(),
  email: text("email").notNull().default(""),
  birthday: text("birthday").notNull().default(""),
  notes: text("notes").notNull().default(""),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  visits: integer("visits").notNull().default(0),
  spend: integer("spend").notNull().default(0),
  points: integer("points").notNull().default(0),
  lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("horeca_guests_phone_uq").on(t.projectId, t.phone)]);

export const horecaFeedback = pgTable("horeca_feedback", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("horeca_feedback_order_uq").on(t.orderId), index("horeca_feedback_project_idx").on(t.projectId, t.createdAt)]);

// ─── CRM (workspace-wide) ────────────────────────────────────────────────────

/** How the CRM runs for a workspace: lead capture, assignment, visibility, scoring, templates. */
export const crmSettings = pgTable("crm_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  currency: text("currency").notNull().default("INR"),
  /** all = everyone sees every record; own = members without crm:manage see records they own. */
  visibility: text("visibility").notNull().default("all"),
  /** none | round_robin | default (one person) — for leads that arrive by themselves. */
  assignment: text("assignment").notNull().default("none"),
  defaultOwnerId: uuid("default_owner_id").references(() => users.id, { onDelete: "set null" }),
  rrCursor: integer("rr_cursor").notNull().default(0),
  /** Token in the public web-to-lead URL. */
  captureToken: text("capture_token").notNull(),
  settings: jsonb("settings").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_settings_token_uq").on(t.captureToken)]);

export const crmPipelines = pgTable("crm_pipelines", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("crm_pipelines_org_idx").on(t.orgId)]);

export const crmStages = pgTable("crm_stages", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  pipelineId: uuid("pipeline_id").notNull().references(() => crmPipelines.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** Chance of winning a deal in this stage, 0–100 (weighted forecast). */
  probability: integer("probability").notNull().default(0),
  /** open | won | lost */
  kind: text("kind").notNull().default("open"),
  /** A deal that sits here longer than this many days is flagged (0 = never). */
  rotDays: integer("rot_days").notNull().default(0),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("crm_stages_pipeline_idx").on(t.pipelineId, t.sort)]);

export const crmCompanies = pgTable("crm_companies", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  domain: text("domain").notNull().default(""),
  industry: text("industry").notNull().default(""),
  size: text("size").notNull().default(""),
  phone: text("phone").notNull().default(""),
  website: text("website").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  country: text("country").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  custom: jsonb("custom").notNull().default({}),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_companies_org_idx").on(t.orgId, t.name), index("crm_companies_domain_idx").on(t.orgId, t.domain)]);

export const crmContacts = pgTable("crm_contacts", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  title: text("title").notNull().default(""),
  companyId: uuid("company_id").references(() => crmCompanies.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  /** subscriber | lead | qualified | opportunity | customer | evangelist | other */
  lifecycle: text("lifecycle").notNull().default("lead"),
  /** new | contacted | working | unqualified (lead status, while still a lead) */
  leadStatus: text("lead_status").notNull().default("new"),
  source: text("source").notNull().default("manual"),
  score: integer("score").notNull().default(0),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  custom: jsonb("custom").notNull().default({}),
  city: text("city").notNull().default(""),
  country: text("country").notNull().default(""),
  /** Agreed to marketing email. */
  marketing: boolean("marketing").notNull().default(false),
  /** Asked not to be contacted: sequences skip them and email is blocked. */
  doNotContact: boolean("do_not_contact").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("crm_contacts_email_uq").on(t.orgId, sql`lower(${t.email})`).where(sql`${t.email} <> ''`),
  index("crm_contacts_phone_idx").on(t.orgId, t.phone),
  index("crm_contacts_org_idx").on(t.orgId, t.updatedAt),
  index("crm_contacts_company_idx").on(t.companyId),
]);

export const crmDeals = pgTable("crm_deals", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  pipelineId: uuid("pipeline_id").notNull().references(() => crmPipelines.id, { onDelete: "cascade" }),
  stageId: uuid("stage_id").notNull().references(() => crmStages.id),
  title: text("title").notNull(),
  /** Minor units (paise). */
  value: bigint("value", { mode: "number" }).notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => crmCompanies.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  expectedClose: date("expected_close"),
  /** open | won | lost */
  status: text("status").notNull().default("open"),
  lostReason: text("lost_reason").notNull().default(""),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  source: text("source").notNull().default(""),
  priority: text("priority").notNull().default("normal"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  custom: jsonb("custom").notNull().default({}),
  /** Order inside its stage column. */
  position: real("position").notNull().default(0),
  stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_deals_board_idx").on(t.orgId, t.pipelineId, t.stageId, t.position), index("crm_deals_contact_idx").on(t.contactId), index("crm_deals_company_idx").on(t.companyId)]);

/** The timeline: notes, calls, emails, meetings, tasks — and system events like stage changes. */
export const crmActivities = pgTable("crm_activities", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** note | call | email | meeting | task | event */
  kind: text("kind").notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").references(() => crmCompanies.id, { onDelete: "cascade" }),
  dealId: uuid("deal_id").references(() => crmDeals.id, { onDelete: "cascade" }),
  /** Who it's assigned to (tasks) or who did it. */
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  doneAt: timestamp("done_at", { withTimezone: true }),
  /** Calls: connected | no_answer | voicemail | busy | wrong_number; meetings: held | no_show */
  outcome: text("outcome").notNull().default(""),
  durationMin: integer("duration_min"),
  priority: text("priority").notNull().default("normal"),
  meta: jsonb("meta").notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [
  index("crm_activities_contact_idx").on(t.contactId, t.createdAt),
  index("crm_activities_deal_idx").on(t.dealId, t.createdAt),
  index("crm_activities_company_idx").on(t.companyId, t.createdAt),
  index("crm_activities_tasks_idx").on(t.orgId, t.kind, t.doneAt, t.dueAt),
]);

/** Extra fields a workspace adds to contacts, companies or deals. */
export const crmFields = pgTable("crm_fields", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  /** text | number | date | select | checkbox | url */
  type: text("type").notNull().default("text"),
  options: text("options").array().notNull().default(sql`'{}'::text[]`),
  sort: integer("sort").notNull().default(0),
}, (t) => [uniqueIndex("crm_fields_key_uq").on(t.orgId, t.entity, t.key)]);

/** Saved filters on a list. userId null = shared with the workspace. */
export const crmViews = pgTable("crm_views", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  name: text("name").notNull(),
  query: jsonb("query").notNull(),
  createdAt: createdAt(),
}, (t) => [index("crm_views_org_idx").on(t.orgId, t.entity)]);

/** Follow-up sequences: emails and tasks spaced out over days. */
export const crmSequences = pgTable("crm_sequences", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  steps: jsonb("steps").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("crm_sequences_org_idx").on(t.orgId)]);

export const crmEnrollments = pgTable("crm_enrollments", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  sequenceId: uuid("sequence_id").notNull().references(() => crmSequences.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => crmContacts.id, { onDelete: "cascade" }),
  /** Index of the next step to run. */
  step: integer("step").notNull().default(0),
  /** active | finished | stopped */
  status: text("status").notNull().default("active"),
  stopReason: text("stop_reason").notNull().default(""),
  nextAt: timestamp("next_at", { withTimezone: true }),
  enrolledBy: uuid("enrolled_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("crm_enrollments_uq").on(t.sequenceId, t.contactId), index("crm_enrollments_due_idx").on(t.status, t.nextAt)]);

// ─── HR & payroll (workspace-wide) ───────────────────────────────────────────

/** Company details, work week and shift, payroll rules, checklists and letter templates. */
export const hrSettings = pgTable("hr_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
  nextEmpNo: integer("next_emp_no").notNull().default(1),
  /** Token in the public careers page URL. */
  careersToken: text("careers_token").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("hr_settings_careers_uq").on(t.careersToken)]);

export const hrDepartments = pgTable("hr_departments", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  headId: uuid("head_id"),
  createdAt: createdAt(),
}, (t) => [index("hr_departments_org_idx").on(t.orgId)]);

export const hrLocations = pgTable("hr_locations", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  branchId: uuid("branch_id"),
  address: text("address").notNull().default(""),
  /** Two-letter state code, for professional tax. */
  state: text("state").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("hr_locations_org_idx").on(t.orgId)]);

export const hrEmployees = pgTable("hr_employees", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  empNo: text("emp_no").notNull(),
  /** The workspace member this person signs in as (for self-service). */
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** A Horeca till login, whose unlocks count as attendance. */
  horecaStaffId: uuid("horeca_staff_id"),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  personalEmail: text("personal_email").notNull().default(""),
  dob: date("dob"),
  gender: text("gender").notNull().default(""),
  address: text("address").notNull().default(""),
  emergency: jsonb("emergency").notNull().default({}),
  designation: text("designation").notNull().default(""),
  departmentId: uuid("department_id").references(() => hrDepartments.id, { onDelete: "set null" }),
  locationId: uuid("location_id").references(() => hrLocations.id, { onDelete: "set null" }),
  /** Where their pay is charged in the books. */
  costCentreId: uuid("cost_centre_id"),
  managerId: uuid("manager_id"),
  /** full_time | part_time | contract | intern */
  employmentType: text("employment_type").notNull().default("full_time"),
  joinDate: date("join_date").notNull(),
  probationEnd: date("probation_end"),
  /** active | notice | exited */
  status: text("status").notNull().default("active"),
  noticeFrom: date("notice_from"),
  exitDate: date("exit_date"),
  exitReason: text("exit_reason").notNull().default(""),
  /** Cost to company per year, in paise. */
  ctc: bigint("ctc", { mode: "number" }).notNull().default(0),
  /** Overrides of the workspace salary structure (basic %, HRA %, fixed allowances). */
  salary: jsonb("salary").notNull().default({}),
  bank: jsonb("bank").notNull().default({}),
  /** PAN, UAN, ESIC number, last 4 of Aadhaar. */
  ids: jsonb("ids").notNull().default({}),
  custom: jsonb("custom").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("hr_employees_no_uq").on(t.orgId, t.empNo),
  uniqueIndex("hr_employees_user_uq").on(t.orgId, t.userId).where(sql`${t.userId} is not null`),
  index("hr_employees_manager_idx").on(t.managerId),
  index("hr_employees_org_idx").on(t.orgId, t.status),
]);

export const hrHolidays = pgTable("hr_holidays", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  name: text("name").notNull(),
  /** Optional (restricted) holidays are taken as leave of choice. */
  optional: boolean("optional").notNull().default(false),
  locationId: uuid("location_id").references(() => hrLocations.id, { onDelete: "cascade" }),
}, (t) => [index("hr_holidays_org_idx").on(t.orgId, t.date)]);

export const hrLeaveTypes = pgTable("hr_leave_types", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  /** Days a year. */
  quota: real("quota").notNull().default(0),
  /** yearly (all at the start) | monthly (a twelfth each month) | none (unlimited / unpaid) */
  accrual: text("accrual").notNull().default("yearly"),
  carryForward: real("carry_forward").notNull().default(0),
  paid: boolean("paid").notNull().default(true),
  allowHalf: boolean("allow_half").notNull().default(true),
  color: text("color").notNull().default("#2a78d6"),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
}, (t) => [index("hr_leave_types_org_idx").on(t.orgId)]);

/** Opening (carried forward) and manual adjustments per year; accrued and used are worked out live. */
export const hrLeaveBalances = pgTable("hr_leave_balances", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => hrLeaveTypes.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  opening: real("opening").notNull().default(0),
  adjusted: real("adjusted").notNull().default(0),
}, (t) => [uniqueIndex("hr_leave_balances_uq").on(t.employeeId, t.leaveTypeId, t.year)]);

export const hrLeaveRequests = pgTable("hr_leave_requests", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  leaveTypeId: uuid("leave_type_id").notNull().references(() => hrLeaveTypes.id, { onDelete: "cascade" }),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  /** none | first | second (half of a single day) */
  half: text("half").notNull().default("none"),
  days: real("days").notNull(),
  reason: text("reason").notNull().default(""),
  /** pending | approved | rejected | cancelled */
  status: text("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("hr_leave_requests_emp_idx").on(t.employeeId, t.fromDate), index("hr_leave_requests_org_idx").on(t.orgId, t.status)]);

export const hrAttendance = pgTable("hr_attendance", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true }),
  checkOut: timestamp("check_out", { withTimezone: true }),
  minutes: integer("minutes").notNull().default(0),
  /** present | half_day | absent */
  status: text("status").notNull().default("present"),
  late: boolean("late").notNull().default(false),
  /** web | manual | regularised | horeca */
  source: text("source").notNull().default("web"),
  note: text("note").notNull().default(""),
}, (t) => [uniqueIndex("hr_attendance_uq").on(t.employeeId, t.date), index("hr_attendance_org_idx").on(t.orgId, t.date)]);

/** Corrections to attendance ("I forgot to check out"), approved by a manager or HR. */
export const hrRegularisations = pgTable("hr_regularisations", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true }).notNull(),
  checkOut: timestamp("check_out", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("hr_regularisations_org_idx").on(t.orgId, t.status)]);

export const hrPayrollRuns = pgTable("hr_payroll_runs", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** YYYY-MM */
  month: text("month").notNull(),
  /** draft | finalised | paid */
  status: text("status").notNull().default("draft"),
  totals: jsonb("totals").notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  finalisedAt: timestamp("finalised_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_payroll_runs_month_uq").on(t.orgId, t.month)]);

export const hrPayslips = pgTable("hr_payslips", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  runId: uuid("run_id").notNull().references(() => hrPayrollRuns.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  /** Earnings, deductions, employer costs and days, as computed. */
  data: jsonb("data").notNull(),
  /** One-off lines for this month: bonus, arrears, advance recovery… */
  adjustments: jsonb("adjustments").notNull().default([]),
  gross: bigint("gross", { mode: "number" }).notNull().default(0),
  deductions: bigint("deductions", { mode: "number" }).notNull().default(0),
  net: bigint("net", { mode: "number" }).notNull().default(0),
  hold: boolean("hold").notNull().default(false),
}, (t) => [uniqueIndex("hr_payslips_uq").on(t.runId, t.employeeId), index("hr_payslips_emp_idx").on(t.employeeId)]);

export const hrClaims = pgTable("hr_claims", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  date: date("date").notNull(),
  description: text("description").notNull().default(""),
  receiptUrl: text("receipt_url").notNull().default(""),
  /** pending | approved | rejected | paid */
  status: text("status").notNull().default("pending"),
  payrollRunId: uuid("payroll_run_id").references(() => hrPayrollRuns.id, { onDelete: "set null" }),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  /** expense | mileage | per_diem */
  kind: text("kind").notNull().default("expense"),
  km: real("km"),
  vehicle: text("vehicle"),
  /** The trip it was spent on; settled against the trip's advance, not paid in payroll. */
  tripId: uuid("trip_id"),
  /** A project to put it on; billable ones go on the project's next invoice. */
  projectId: uuid("project_id"),
  billable: boolean("billable").notNull().default(false),
  /** What it breaks in the expense policy, and the reason given. */
  flags: jsonb("flags").$type<{ code: string; message: string }[]>().notNull().default([]),
  justification: text("justification").notNull().default(""),
  /** employee (reimbursed) | company (on a company card, nothing to pay back) */
  paidBy: text("paid_by").notNull().default("employee"),
  cardTxnId: uuid("card_txn_id"),
  createdAt: createdAt(),
}, (t) => [index("hr_claims_org_idx").on(t.orgId, t.status), index("hr_claims_emp_idx").on(t.employeeId), index("hr_claims_trip_idx").on(t.tripId)]);

/** A business trip: approved before it starts, with an advance, settled against what's claimed. */
export const hrTrips = pgTable("hr_trips", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(),
  destination: text("destination").notNull(),
  international: boolean("international").notNull().default(false),
  departOn: date("depart_on").notNull(),
  returnOn: date("return_on").notNull(),
  mode: text("mode").notNull().default("Flight"),
  estimate: bigint("estimate", { mode: "number" }).notNull().default(0),
  /** Advance asked for, and once paid, from which account and when. */
  advance: bigint("advance", { mode: "number" }).notNull().default(0),
  advancePaidOn: date("advance_paid_on"),
  advanceAccountId: uuid("advance_account_id"),
  projectId: uuid("project_id"),
  notes: text("notes").notNull().default(""),
  /** draft | pending | approving | approved | rejected | cancelled | settled */
  status: text("status").notNull().default("draft"),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decisionNote: text("decision_note").notNull().default(""),
  /** Settled: claimed, advance and the balance paid (+) or returned (−), through which account. */
  settledOn: date("settled_on"),
  settleAccountId: uuid("settle_account_id"),
  claimed: bigint("claimed", { mode: "number" }).notNull().default(0),
  balance: bigint("balance", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_trips_number_uq").on(t.orgId, t.number), index("hr_trips_emp_idx").on(t.employeeId, t.status)]);

/** Company cards and who holds them, matched to statement lines by the last four digits. */
export const hrCards = pgTable("hr_cards", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  last4: text("last4").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_cards_last4_uq").on(t.orgId, t.last4)]);

/** A company-card statement line, explained by the cardholder as a claim, or marked personal and repaid. */
export const hrCardTxns = pgTable("hr_card_txns", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  cardId: uuid("card_id").notNull().references(() => hrCards.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  merchant: text("merchant").notNull().default(""),
  reference: text("reference").notNull().default(""),
  amount: bigint("amount", { mode: "number" }).notNull(),
  fingerprint: text("fingerprint").notNull(),
  /** open | explained | personal | repaid */
  status: text("status").notNull().default("open"),
  claimId: uuid("claim_id"),
  repaidOn: date("repaid_on"),
  repaidAccountId: uuid("repaid_account_id"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_card_txns_fp_uq").on(t.cardId, t.fingerprint), index("hr_card_txns_emp_idx").on(t.employeeId, t.status)]);

export const hrJobs = pgTable("hr_jobs", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  departmentId: uuid("department_id").references(() => hrDepartments.id, { onDelete: "set null" }),
  locationId: uuid("location_id").references(() => hrLocations.id, { onDelete: "set null" }),
  employmentType: text("employment_type").notNull().default("full_time"),
  description: text("description").notNull().default(""),
  openings: integer("openings").notNull().default(1),
  salaryRange: text("salary_range").notNull().default(""),
  /** open | paused | closed */
  status: text("status").notNull().default("open"),
  createdAt: createdAt(),
}, (t) => [index("hr_jobs_org_idx").on(t.orgId, t.status)]);

export const hrCandidates = pgTable("hr_candidates", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull().references(() => hrJobs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  source: text("source").notNull().default("manual"),
  /** applied | screening | interview | offer | hired | rejected */
  stage: text("stage").notNull().default("applied"),
  rating: integer("rating").notNull().default(0),
  resumeUrl: text("resume_url").notNull().default(""),
  notes: text("notes").notNull().default(""),
  expectedCtc: bigint("expected_ctc", { mode: "number" }),
  employeeId: uuid("employee_id").references(() => hrEmployees.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("hr_candidates_job_idx").on(t.jobId, t.stage)]);

/** Onboarding and offboarding: a checklist per person. */
export const hrChecklists = pgTable("hr_checklists", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  /** onboarding | offboarding */
  kind: text("kind").notNull(),
  items: jsonb("items").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_checklists_uq").on(t.employeeId, t.kind)]);

export const hrGoals = pgTable("hr_goals", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  progress: integer("progress").notNull().default(0),
  dueDate: date("due_date"),
  /** on_track | at_risk | behind | done */
  status: text("status").notNull().default("on_track"),
  weight: integer("weight").notNull().default(1),
  createdAt: createdAt(),
}, (t) => [index("hr_goals_emp_idx").on(t.employeeId)]);

export const hrReviews = pgTable("hr_reviews", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  cycle: text("cycle").notNull(),
  selfRating: integer("self_rating"),
  selfNote: text("self_note").notNull().default(""),
  managerRating: integer("manager_rating"),
  managerNote: text("manager_note").notNull().default(""),
  /** self | manager | done */
  status: text("status").notNull().default("self"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_reviews_uq").on(t.employeeId, t.cycle)]);

export const hrAssets = pgTable("hr_assets", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tag: text("tag").notNull().default(""),
  serial: text("serial").notNull().default(""),
  category: text("category").notNull().default("laptop"),
  value: bigint("value", { mode: "number" }).notNull().default(0),
  employeeId: uuid("employee_id").references(() => hrEmployees.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  /** available | assigned | repair | retired */
  status: text("status").notNull().default("available"),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [index("hr_assets_org_idx").on(t.orgId)]);

/** A person's HR history: joined, promoted, salary revised, letters issued, exit. */
export const hrEvents = pgTable("hr_events", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  subject: text("subject").notNull(),
  meta: jsonb("meta").notNull().default({}),
  by: uuid("by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("hr_events_emp_idx").on(t.employeeId, t.createdAt)]);

export const hrAnnouncements = pgTable("hr_announcements", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  pinned: boolean("pinned").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("hr_announcements_org_idx").on(t.orgId, t.createdAt)]);

// ─── Inventory & purchasing (workspace-level) ───
// Quantities are numeric(14,3) so items can be counted in kg or litres; money
// is in paise. An item linked to a store variant keeps its shop-shelf quantity
// in that variant's own stock (the store's warehouse reads and writes it), so
// there's one number for what's on sale.

const qty = (name: string) => numeric(name, { precision: 14, scale: 3, mode: "number" });

export const invSettings = pgTable("inv_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  nextPo: integer("next_po").notNull().default(1),
  nextGrn: integer("next_grn").notNull().default(1),
  nextTransfer: integer("next_transfer").notNull().default(1),
  /** Further numbering: requisition, rfq, return. */
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invWarehouses = pgTable(
  "inv_warehouses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    branchId: uuid("branch_id"),
    code: text("code").notNull().default(""),
    address: text("address").notNull().default(""),
    /** Two-letter state code, for CGST/SGST vs IGST on purchases. */
    state: text("state").notNull().default(""),
    /** The shop floor of this project's store: its quantity is the variants' own stock. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("inv_warehouses_org_idx").on(t.orgId), uniqueIndex("inv_warehouses_project_uq").on(t.projectId).where(sql`${t.projectId} is not null`)],
);

export const invSuppliers = pgTable(
  "inv_suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contactName: text("contact_name").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    gstin: text("gstin").notNull().default(""),
    state: text("state").notNull().default(""),
    address: text("address").notNull().default(""),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    leadTimeDays: integer("lead_time_days").notNull().default(7),
    notes: text("notes").notNull().default(""),
    /** For TDS: the supplier's PAN, usual section and whether it's a company. */
    pan: text("pan").notNull().default(""),
    tdsSection: text("tds_section").notNull().default(""),
    deductee: text("deductee").notNull().default("other"),
    /** Where payment runs send money: { name, account, ifsc }. */
    bank: jsonb("bank").$type<{ name?: string; account?: string; ifsc?: string }>().notNull().default({}),
    /** New bank details waiting for approval (when the workspace has a policy for supplier bank changes). */
    pendingBank: jsonb("pending_bank").$type<{ name?: string; account?: string; ifsc?: string; requestedBy: string | null; at: string; ref: string } | null>(),
    /** Onboarding: pending | approved | blocked, the documents checked, and who approved them. */
    approval: text("approval").notNull().default("approved"),
    checklist: jsonb("checklist").$type<Record<string, boolean>>().notNull().default({}),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("inv_suppliers_org_idx").on(t.orgId)],
);

export const invItems = pgTable(
  "inv_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sku: text("sku").notNull().default(""),
    barcode: text("barcode").notNull().default(""),
    unit: text("unit").notNull().default("pcs"),
    category: text("category").notNull().default(""),
    hsn: text("hsn").notNull().default(""),
    gstRate: real("gst_rate").notNull().default(18),
    /** Weighted average cost per unit, in paise. */
    avgCost: integer("avg_cost").notNull().default(0),
    trackBatches: boolean("track_batches").notNull().default(false),
    reorderLevel: qty("reorder_level").notNull().default(0),
    reorderQty: qty("reorder_qty").notNull().default(0),
    /** Kept back for surprises: reorder suggestions keep stock above reorder level plus this. */
    safetyStock: qty("safety_stock").notNull().default(0),
    /** Each unit has its own serial number. */
    trackSerials: boolean("track_serials").notNull().default(false),
    supplierId: uuid("supplier_id").references(() => invSuppliers.id, { onDelete: "set null" }),
    /** Linked store variant: its stock is this item's quantity in that store's warehouse. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    variantId: uuid("variant_id").references(() => storeVariants.id, { onDelete: "set null" }),
    notes: text("notes").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inv_items_org_idx").on(t.orgId),
    uniqueIndex("inv_items_variant_uq").on(t.variantId).where(sql`${t.variantId} is not null`),
    uniqueIndex("inv_items_sku_uq").on(t.orgId, sql`lower(${t.sku})`).where(sql`${t.sku} <> ''`),
  ],
);

/** Quantity on hand per item, location and batch ('' = no batch). Not used for a store's own shelf. */
export const invStock = pgTable(
  "inv_stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => invWarehouses.id, { onDelete: "cascade" }),
    batch: text("batch").notNull().default(""),
    expiry: date("expiry"),
    qty: qty("qty").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inv_stock_uq").on(t.itemId, t.warehouseId, t.batch), index("inv_stock_wh_idx").on(t.warehouseId)],
);

/** Every change to stock, with why. */
export const invMoves = pgTable(
  "inv_moves",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => invWarehouses.id, { onDelete: "cascade" }),
    batch: text("batch").notNull().default(""),
    qty: qty("qty").notNull(),
    /** receive | issue | adjust | count | transfer_out | transfer_in | return */
    kind: text("kind").notNull(),
    /** Unit cost at the time, in paise. */
    unitCost: integer("unit_cost").notNull().default(0),
    refType: text("ref_type").notNull().default(""),
    refId: uuid("ref_id"),
    refNo: text("ref_no").notNull().default(""),
    note: text("note").notNull().default(""),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("inv_moves_item_idx").on(t.itemId, t.createdAt), index("inv_moves_org_idx").on(t.orgId, t.createdAt)],
);

export const invPurchaseOrders = pgTable(
  "inv_purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull().references(() => invSuppliers.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => invWarehouses.id, { onDelete: "restrict" }),
    /** draft | sent | partial | received | closed | cancelled */
    status: text("status").notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    /** [{ itemId, qty, rate, gstRate, received }] — rate in paise per unit */
    lines: jsonb("lines").$type<{ itemId: string; qty: number; rate: number; gstRate: number; received: number }[]>().notNull().default([]),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    tax: bigint("tax", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    interState: boolean("inter_state").notNull().default(false),
    notes: text("notes").notNull().default(""),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The supplier's acknowledgement through the portal: when, the date they promise, a note. */
    supplierAck: jsonb("supplier_ack").$type<{ at: string; by: string; promisedDate: string | null; note: string } | null>(),
    /** Dispatches the supplier told us about (advance shipping notices). */
    dispatches: jsonb("dispatches").$type<{ id: string; at: string; by: string; date: string; reference: string; carrier: string; note: string }[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inv_po_number_uq").on(t.orgId, t.number), index("inv_po_status_idx").on(t.orgId, t.status)],
);

/** Goods received: against a purchase order or on their own. */
export const invReceipts = pgTable(
  "inv_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    poId: uuid("po_id").references(() => invPurchaseOrders.id, { onDelete: "set null" }),
    supplierId: uuid("supplier_id").references(() => invSuppliers.id, { onDelete: "set null" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => invWarehouses.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    supplierInvoice: text("supplier_invoice").notNull().default(""),
    /** [{ itemId, qty, rate, gstRate, batch, expiry }] */
    /** qty is what was accepted into stock; rejected (at inspection) didn't go in. */
    lines: jsonb("lines").$type<{ itemId: string; qty: number; rate: number; gstRate: number; batch: string; expiry: string | null; rejected?: number; rejectReason?: string }[]>().notNull().default([]),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    tax: bigint("tax", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inv_grn_number_uq").on(t.orgId, t.number), index("inv_grn_po_idx").on(t.poId)],
);

export const invTransfers = pgTable(
  "inv_transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    fromId: uuid("from_id").notNull().references(() => invWarehouses.id, { onDelete: "restrict" }),
    toId: uuid("to_id").notNull().references(() => invWarehouses.id, { onDelete: "restrict" }),
    /** draft | in_transit | received | cancelled */
    status: text("status").notNull().default("draft"),
    /** [{ itemId, qty, batch }] */
    lines: jsonb("lines").$type<{ itemId: string; qty: number; batch: string }[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inv_transfer_number_uq").on(t.orgId, t.number)],
);

/** A physical count of a location: what was there vs what the system expected. */
export const invCounts = pgTable("inv_counts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").notNull().references(() => invWarehouses.id, { onDelete: "cascade" }),
  /** [{ itemId, batch, expected, counted }] */
  lines: jsonb("lines").$type<{ itemId: string; batch: string; expected: number; counted: number }[]>().notNull().default([]),
  /** Value of the difference, in paise (negative = short). */
  varianceValue: bigint("variance_value", { mode: "number" }).notNull().default(0),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});


// ─── Accounting & GST (workspace-level) ───
// A double-entry ledger. Journals are either made by hand (manual, opening,
// bank) or posted from documents elsewhere in Cloudesk — invoices, payments,
// store and POS sales, goods received, payroll — keyed by their source so a
// sync can add, update or remove them as the source changes. Money is paise.

export const accSettings = pgTable("acc_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  nextJournal: integer("next_journal").notNull().default(1),
  nextBill: integer("next_bill").notNull().default(1),
  /** Further numbering sequences (debit notes, payment runs, receipts), by key. */
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  /** What the last sync couldn't post, and why. */
  syncNotes: jsonb("sync_notes").$type<{ source: string; ref: string; why: string }[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accAccounts = pgTable(
  "acc_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** asset | liability | equity | income | expense */
    type: text("type").notNull(),
    /** bank | cash | receivable | payable | tax_in | tax_out | inventory | fixed | current | other */
    subtype: text("subtype").notNull().default("other"),
    /** Accounts Cloudesk posts to by name: "sales", "ar", "cgst_out"… */
    systemKey: text("system_key"),
    description: text("description").notNull().default(""),
    /** For bank accounts: bank, last 4 digits, IFSC. */
    bank: jsonb("bank").$type<{ bankName?: string; last4?: string; ifsc?: string }>(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("acc_accounts_code_uq").on(t.orgId, t.code), uniqueIndex("acc_accounts_key_uq").on(t.orgId, t.systemKey).where(sql`${t.systemKey} is not null`)],
);

export const accJournals = pgTable(
  "acc_journals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    date: date("date").notNull(),
    narration: text("narration").notNull().default(""),
    /** manual | opening | bank | invoice | credit_note | invoice_payment | store_sale | store_refund | bill | bill_payment | stock | payroll | payroll_payment | claim */
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    /** The legal entity it belongs to (null: the workspace's default company). */
    companyId: uuid("company_id"),
    /** The source's own number: INV-0004, #1023, GRN-0002, Oct 2026 payroll. */
    sourceRef: text("source_ref").notNull().default(""),
    party: text("party").notNull().default(""),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    /** Fingerprint of the posted lines, so a sync knows when its source changed. */
    hash: text("hash").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("acc_journals_source_uq").on(t.orgId, t.sourceType, t.sourceId).where(sql`${t.sourceId} is not null`), index("acc_journals_date_idx").on(t.orgId, t.date)],
);

export const accLines = pgTable(
  "acc_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    journalId: uuid("journal_id").notNull().references(() => accJournals.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accAccounts.id, { onDelete: "restrict" }),
    debit: bigint("debit", { mode: "number" }).notNull().default(0),
    credit: bigint("credit", { mode: "number" }).notNull().default(0),
    description: text("description").notNull().default(""),
    /** Dimensions: cost or profit centre / business unit, and branch. */
    costCentreId: uuid("cost_centre_id"),
    branchId: uuid("branch_id"),
    /** The other company in the group, on an intercompany balance — eliminated on consolidation. */
    partnerCompanyId: uuid("partner_company_id"),
    /** Matched to a bank statement line. */
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
  },
  (t) => [index("acc_lines_account_idx").on(t.accountId), index("acc_lines_journal_idx").on(t.journalId)],
);

/** Supplier bills and expenses: what you owe (or paid on the spot). */
export const accBills = pgTable(
  "acc_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    /** The supplier, shared with Inventory. */
    supplierId: uuid("supplier_id").references(() => invSuppliers.id, { onDelete: "set null" }),
    supplierName: text("supplier_name").notNull().default(""),
    /** The supplier's own bill or invoice number. */
    billNo: text("bill_no").notNull().default(""),
    date: date("date").notNull(),
    dueDate: date("due_date"),
    /** [{ accountId, description, amount, gstRate }] — amount before GST, paise */
    lines: jsonb("lines").$type<{ accountId: string; description: string; amount: number; gstRate: number; costCentreId?: string | null; fxAmount?: number }[]>().notNull().default([]),
    /** Whether GST on it can be claimed as input credit. */
    itc: boolean("itc").notNull().default(true),
    interState: boolean("inter_state").notNull().default(false),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    tax: bigint("tax", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    amountPaid: bigint("amount_paid", { mode: "number" }).notNull().default(0),
    /** open | partial | paid | void */
    status: text("status").notNull().default("open"),
    /** Made from goods received in Inventory. */
    receiptId: uuid("receipt_id").references(() => invReceipts.id, { onDelete: "set null" }),
    /** An expense waiting for approval: the payment to record once it is approved. */
    pendingPayment: jsonb("pending_payment"),
    companyId: uuid("company_id"),
    branchId: uuid("branch_id"),
    /** bill | debit_note (what a supplier owes back on a bill: returns, price cuts) */
    kind: text("kind").notNull().default("bill"),
    againstBillId: uuid("against_bill_id"),
    /** Tax deducted at source on the bill (paise), its section and rate. */
    tdsSection: text("tds_section").notNull().default(""),
    tdsRate: real("tds_rate").notNull().default(0),
    tdsAmount: bigint("tds_amount", { mode: "number" }).notNull().default(0),
    /** Debit notes applied to this bill (paise). */
    credited: bigint("credited", { mode: "number" }).notNull().default(0),
    /** A bill in another currency: amounts above are in rupees at fxRate; fxTotal is the bill's own total (minor units). */
    currency: text("currency").notNull().default("INR"),
    fxRate: numeric("fx_rate", { precision: 18, scale: 6 }),
    fxTotal: bigint("fx_total", { mode: "number" }),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("acc_bills_org_idx").on(t.orgId, t.status), uniqueIndex("acc_bills_receipt_uq").on(t.receiptId).where(sql`${t.receiptId} is not null`)],
);

export const accBillPayments = pgTable("acc_bill_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  billId: uuid("bill_id").notNull().references(() => accBills.id, { onDelete: "cascade" }),
  /** The bank or cash account it was paid from. */
  accountId: uuid("account_id").notNull().references(() => accAccounts.id, { onDelete: "restrict" }),
  /** What it settles on the bill, in rupees at the bill's rate. */
  amount: bigint("amount", { mode: "number" }).notNull(),
  date: date("date").notNull(),
  reference: text("reference").notNull().default(""),
  /** A foreign bill: the amount paid in its currency, and rupees actually paid less what it settles (exchange loss if more). */
  fxAmount: bigint("fx_amount", { mode: "number" }),
  fxDiff: bigint("fx_diff", { mode: "number" }).notNull().default(0),
  createdAt: createdAt(),
});

/** Bank statement lines imported from a CSV, to match against the ledger. */
export const accBankLines = pgTable(
  "acc_bank_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accAccounts.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    description: text("description").notNull().default(""),
    reference: text("reference").notNull().default(""),
    /** Money in is positive, out is negative. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** unmatched | matched | ignored */
    status: text("status").notNull().default("unmatched"),
    lineId: uuid("line_id").references(() => accLines.id, { onDelete: "set null" }),
    /** Same date, amount and description as a line already imported. */
    fingerprint: text("fingerprint").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("acc_bank_lines_account_idx").on(t.accountId, t.status), uniqueIndex("acc_bank_lines_fp_uq").on(t.accountId, t.fingerprint)],
);

// ─── Projects & timesheets (module "work") ───────────────────────────────────

export const workSettings = pgTable("work_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  /** See settingsSchema in lib/work/model. */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  nextProject: integer("next_project").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workProjects = pgTable(
  "work_projects",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** The invoicing books it bills from (a finance book or a project's books), and the client there. */
    ownerId: uuid("owner_id"),
    clientId: uuid("client_id"),
    clientName: text("client_name").notNull().default(""),
    /** The CRM deal it was won from. */
    dealId: uuid("deal_id"),
    /** planned | active | on_hold | done | cancelled */
    status: text("status").notNull().default("active"),
    /** hourly | fixed | none */
    billing: text("billing").notNull().default("hourly"),
    /** Default rate per hour, in paise. */
    rate: bigint("rate", { mode: "number" }).notNull().default(0),
    /** Fixed fee, in paise. */
    fee: bigint("fee", { mode: "number" }).notNull().default(0),
    budgetHours: real("budget_hours").notNull().default(0),
    budgetAmount: bigint("budget_amount", { mode: "number" }).notNull().default(0),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    leadId: uuid("lead_id").references(() => users.id, { onDelete: "set null" }),
    tint: text("tint").notNull().default("sky"),
    nextTask: integer("next_task").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("work_projects_code_uq").on(t.orgId, t.code), index("work_projects_org_idx").on(t.orgId, t.status)],
);

export const workMembers = pgTable(
  "work_members",
  {
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** What the client pays for this person's hour, in paise; null uses the project's rate. */
    rate: bigint("rate", { mode: "number" }),
    /** What this person's hour costs the business, in paise; null uses their HR salary, if any. */
    costRate: bigint("cost_rate", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("work_members_user_idx").on(t.userId)],
);

export const workMilestones = pgTable(
  "work_milestones",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dueDate: date("due_date"),
    /** What's billed when it's reached (fixed-fee projects), in paise. */
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    doneAt: timestamp("done_at", { withTimezone: true }),
    invoiceId: uuid("invoice_id"),
    position: real("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("work_milestones_project_idx").on(t.projectId)],
);

export const workTasks = pgTable(
  "work_tasks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** todo | doing | review | done */
    status: text("status").notNull().default("todo"),
    /** low | normal | high | urgent */
    priority: text("priority").notNull().default("normal"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    milestoneId: uuid("milestone_id").references(() => workMilestones.id, { onDelete: "set null" }),
    parentId: uuid("parent_id"),
    startDate: date("start_date"),
    dueDate: date("due_date"),
    estimateHours: real("estimate_hours").notNull().default(0),
    billable: boolean("billable").notNull().default(true),
    checklist: jsonb("checklist").$type<{ id: string; text: string; done: boolean }[]>().notNull().default([]),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    position: real("position").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("work_tasks_number_uq").on(t.projectId, t.number), index("work_tasks_board_idx").on(t.projectId, t.status, t.position), index("work_tasks_assignee_idx").on(t.orgId, t.assigneeId, t.status)],
);

export const workComments = pgTable(
  "work_comments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => workTasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("work_comments_task_idx").on(t.taskId, t.createdAt)],
);

export const workTime = pgTable(
  "work_time",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => workTasks.id, { onDelete: "set null" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    minutes: integer("minutes").notNull().default(0),
    note: text("note").notNull().default(""),
    billable: boolean("billable").notNull().default(true),
    /** A running timer: minutes are added when it stops. */
    timerStartedAt: timestamp("timer_started_at", { withTimezone: true }),
    /** draft | submitted | approved | rejected */
    status: text("status").notNull().default("draft"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decisionNote: text("decision_note").notNull().default(""),
    /** The invoice this time was billed on, and the rate used (paise per hour). */
    invoiceId: uuid("invoice_id"),
    billedRate: bigint("billed_rate", { mode: "number" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_time_user_idx").on(t.orgId, t.userId, t.date), index("work_time_project_idx").on(t.projectId, t.date), index("work_time_invoice_idx").on(t.invoiceId)],
);

/** One task waiting on another: finish-to-start or start-to-start, with lag in days. */
export const workTaskLinks = pgTable(
  "work_task_links",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    fromId: uuid("from_id").notNull().references(() => workTasks.id, { onDelete: "cascade" }),
    toId: uuid("to_id").notNull().references(() => workTasks.id, { onDelete: "cascade" }),
    /** FS | SS */
    type: text("type").notNull().default("FS"),
    lagDays: integer("lag_days").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("work_task_links_uq").on(t.fromId, t.toId), index("work_task_links_project_idx").on(t.projectId)],
);

/** Someone booked on a project for a stretch of days, at so many hours a day. */
export const workAllocations = pgTable(
  "work_allocations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fromDate: date("from_date").notNull(),
    toDate: date("to_date").notNull(),
    hoursPerDay: real("hours_per_day").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("work_allocations_user_idx").on(t.orgId, t.userId, t.fromDate), index("work_allocations_project_idx").on(t.projectId)],
);

/** Money spent on a project: billable ones go on its next invoice with any markup. */
export const workExpenses = pgTable(
  "work_expenses",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    category: text("category").notNull().default("Other"),
    description: text("description").notNull().default(""),
    vendor: text("vendor").notNull().default(""),
    /** In paise. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    billable: boolean("billable").notNull().default(true),
    markupPct: real("markup_pct").notNull().default(0),
    receiptLink: text("receipt_link").notNull().default(""),
    invoiceId: uuid("invoice_id"),
    /** The HR claim it came from, if someone claimed it back. */
    claimId: uuid("claim_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("work_expenses_project_idx").on(t.projectId, t.date), index("work_expenses_invoice_idx").on(t.invoiceId)],
);

/** Risks (might happen) and issues (have happened) on a project. */
export const workRisks = pgTable(
  "work_risks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    /** risk | issue */
    kind: text("kind").notNull().default("risk"),
    title: text("title").notNull(),
    probability: integer("probability").notNull().default(3),
    impact: integer("impact").notNull().default(3),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    mitigation: text("mitigation").notNull().default(""),
    due: date("due"),
    /** open | watching | closed */
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_risks_project_idx").on(t.projectId, t.status)],
);

/** A change to a project's scope: once approved it moves the budget, fee and due date. */
export const workChanges = pgTable(
  "work_changes",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    hours: real("hours").notNull().default(0),
    /** In paise. */
    fee: bigint("fee", { mode: "number" }).notNull().default(0),
    days: integer("days").notNull().default(0),
    /** draft | pending | approved | rejected */
    status: text("status").notNull().default("draft"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("work_changes_number_uq").on(t.projectId, t.number)],
);

/** Links to a project's documents (contracts, briefs, drives). */
export const workDocs = pgTable(
  "work_docs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => workProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("work_docs_project_idx").on(t.projectId)],
);

// ─── Assets & maintenance (module "maintenance") ─────────────────────────────

export const mntSettings = pgTable("mnt_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const mntAssets = pgTable(
  "mnt_assets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default(""),
    location: text("location").notNull().default(""),
    /** A component of a bigger asset (a motor in a line). */
    parentId: uuid("parent_id"),
    make: text("make").notNull().default(""),
    model: text("model").notNull().default(""),
    serial: text("serial").notNull().default(""),
    /** running | down | maintenance | standby | retired */
    status: text("status").notNull().default("running"),
    criticality: text("criticality").notNull().default("medium"),
    custodianId: uuid("custodian_id").references(() => users.id, { onDelete: "set null" }),
    /** Its line in the fixed-asset register (Accounting). */
    fixedAssetId: uuid("fixed_asset_id"),
    purchaseDate: date("purchase_date"),
    warrantyUntil: date("warranty_until"),
    meterUnit: text("meter_unit").notNull().default(""),
    meter: real("meter"),
    meterAt: date("meter_at"),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mnt_assets_code_uq").on(t.orgId, t.code), index("mnt_assets_org_idx").on(t.orgId, t.status)],
);

export const mntReadings = pgTable(
  "mnt_readings",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => mntAssets.id, { onDelete: "cascade" }),
    value: real("value").notNull(),
    on: date("on").notNull(),
    by: uuid("by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("mnt_readings_asset_idx").on(t.assetId, t.on)],
);

export const mntPlans = pgTable(
  "mnt_plans",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").notNull().references(() => mntAssets.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    everyDays: integer("every_days"),
    everyMeter: real("every_meter"),
    startOn: date("start_on").notNull(),
    startMeter: real("start_meter").notNull().default(0),
    leadDays: integer("lead_days").notNull().default(7),
    leadMeter: real("lead_meter").notNull().default(0),
    checklist: jsonb("checklist").$type<{ id: string; text: string }[]>().notNull().default([]),
    parts: jsonb("parts").$type<{ itemId: string; qty: number }[]>().notNull().default([]),
    estimateHours: real("estimate_hours").notNull().default(0),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    lastDoneOn: date("last_done_on"),
    lastDoneMeter: real("last_done_meter"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("mnt_plans_asset_idx").on(t.assetId)],
);

export const mntOrders = pgTable(
  "mnt_orders",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    assetId: uuid("asset_id").notNull().references(() => mntAssets.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => mntPlans.id, { onDelete: "set null" }),
    /** breakdown | preventive | request | inspection | improvement */
    kind: text("kind").notNull().default("breakdown"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    priority: text("priority").notNull().default("normal"),
    /** requested | open | in_progress | on_hold | done | cancelled */
    status: text("status").notNull().default("open"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    /** When the asset stopped and when it was back, for downtime. */
    downFrom: timestamp("down_from", { withTimezone: true }),
    downTo: timestamp("down_to", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    checklist: jsonb("checklist").$type<{ id: string; text: string; done: boolean; note?: string }[]>().notNull().default([]),
    labour: jsonb("labour").$type<{ userId: string; minutes: number; rate: number; on: string }[]>().notNull().default([]),
    /** Parts issued from stock, at stock cost (paise). */
    parts: jsonb("parts").$type<{ itemId: string; qty: number; cost: number }[]>().notNull().default([]),
    partsCost: bigint("parts_cost", { mode: "number" }).notNull().default(0),
    /** Outside work (a vendor's visit), paise. */
    externalCost: bigint("external_cost", { mode: "number" }).notNull().default(0),
    externalNote: text("external_note").notNull().default(""),
    failure: text("failure").notNull().default(""),
    cause: text("cause").notNull().default(""),
    remedy: text("remedy").notNull().default(""),
    meterAtDone: real("meter_at_done"),
    warehouseId: uuid("warehouse_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mnt_orders_number_uq").on(t.orgId, t.number), index("mnt_orders_asset_idx").on(t.assetId, t.status), index("mnt_orders_org_idx").on(t.orgId, t.status)],
);

export const mntContracts = pgTable(
  "mnt_contracts",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("amc"),
    vendor: text("vendor").notNull(),
    supplierId: uuid("supplier_id"),
    reference: text("reference").notNull().default(""),
    assetIds: uuid("asset_ids").array().notNull().default(sql`'{}'::uuid[]`),
    startOn: date("start_on").notNull(),
    endOn: date("end_on").notNull(),
    cost: bigint("cost", { mode: "number" }).notNull().default(0),
    visits: integer("visits").notNull().default(0),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("mnt_contracts_org_idx").on(t.orgId, t.endOn)],
);

// ─── Documents, contracts & e-sign (module "documents") ──────────────────────

export const docSettings = pgTable("doc_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const docFolders = pgTable(
  "doc_folders",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    /** team | managers | members */
    access: text("access").notNull().default("team"),
    memberIds: uuid("member_ids").array().notNull().default(sql`'{}'::uuid[]`),
    /** A colour for the folder's icon (one of the drive's swatches), or "" for the default. */
    color: text("color").notNull().default(""),
    /** In the trash since (with everything in it); purged after 30 days. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("doc_folders_org_idx").on(t.orgId, t.parentId)],
);

export const docFiles = pgTable(
  "doc_files",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => docFolders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    /** draft | final | archived */
    status: text("status").notNull().default("final"),
    expiresOn: date("expires_on"),
    /** A record elsewhere it belongs to (a deal, an employee, a project…). */
    linkType: text("link_type"),
    linkId: uuid("link_id"),
    notes: text("notes").notNull().default(""),
    version: integer("version").notNull().default(1),
    /** file: an upload with versions · doc: written here in the editor. */
    kind: text("kind").notNull().default("file"),
    /** A written document's content (editor JSON) — kept in step with its live copy. */
    content: jsonb("content").$type<Record<string, unknown>>(),
    /** Its words, for search and previews. */
    bodyText: text("body_text").notNull().default(""),
    words: integer("words").notNull().default(0),
    /** Page size, orientation, margins, header and footer. */
    page: jsonb("page").$type<Record<string, unknown>>().notNull().default({}),
    icon: text("icon").notNull().default(""),
    /** inherit: whoever can open its folder · private: its owner and the people it's shared with. */
    access: text("access").notNull().default("inherit"),
    /** A link anyone can open (view or comment): the random value it's signed from (with APP_ENCRYPTION_KEY), so it can be shown again but not guessed. */
    shareNonce: text("share_token_hash"),
    shareRole: text("share_role"),
    shareExpiresAt: timestamp("share_expires_at", { withTimezone: true }),
    /** Deleted completely at this time (every version and its log too) — a Drive QR upload's chosen stay, or set by hand. */
    deleteAt: timestamp("delete_at", { withTimezone: true }),
    /** Uploaded through this Drive QR (doc_drops), by someone who may not have an account. */
    dropId: uuid("drop_id"),
    /** Who uploaded it through the QR, as they gave it: name, email (told of every access, with a delete link), device. */
    dropFrom: jsonb("drop_from").$type<{ name: string; email: string; ip: string | null; userAgent: string | null }>(),
    /** The random value the uploader's delete link is signed from (with APP_ENCRYPTION_KEY). */
    dropNonce: text("drop_nonce"),
    lastEditedBy: uuid("last_edited_by"),
    /** In the trash since; purged after 30 days. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("doc_files_org_idx").on(t.orgId, t.folderId), index("doc_files_link_idx").on(t.orgId, t.linkType, t.linkId), uniqueIndex("doc_files_share_uq").on(t.shareNonce), index("doc_files_owner_idx").on(t.orgId, t.createdBy), index("doc_files_delete_at_idx").on(t.deleteAt).where(sql`delete_at is not null`)],
);

/**
 * A Drive QR: anyone who scans it can upload into one folder from their phone,
 * without an account. Each upload stays for the chosen time and is then
 * deleted completely. The link is signed from `nonce` (so it can be shown
 * again, and changed to stop the old one working).
 */
export const docDrops = pgTable(
  "doc_drops",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** Where uploads land; null with root "team" (the top of Team) or "mine" (the owner's My documents). */
    folderId: uuid("folder_id").references(() => docFolders.id, { onDelete: "cascade" }),
    root: text("root").notNull().default("team"),
    /** Shown on the upload page ("Front desk", "Print counter"). */
    name: text("name").notNull().default(""),
    enabled: boolean("enabled").notNull().default(true),
    nonce: text("nonce").notNull(),
    /** How long an upload stays, in minutes; null keeps it. */
    stayMinutes: integer("stay_minutes"),
    /** The uploader picks how long (up to `stayMinutes`, or any choice when it's null). */
    uploaderChooses: boolean("uploader_chooses").notNull().default(true),
    /** Tell its owner about each upload. */
    notifyOwner: boolean("notify_owner").notNull().default(true),
    uploads: integer("uploads").notNull().default(0),
    lastUploadAt: timestamp("last_upload_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("doc_drops_org_idx").on(t.orgId, t.folderId)],
);

/** Someone a file or folder is shared with, and what they may do: view, comment or edit. */
export const docShares = pgTable(
  "doc_shares",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => docFiles.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id").references(() => docFolders.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("view"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("doc_shares_file_uq").on(t.fileId, t.userId), uniqueIndex("doc_shares_folder_uq").on(t.folderId, t.userId), index("doc_shares_user_idx").on(t.orgId, t.userId)],
);

/** Starred files and folders, per person. */
export const docStars = pgTable(
  "doc_stars",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    /** file | folder */
    kind: text("kind").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] }), index("doc_stars_org_idx").on(t.orgId, t.userId)],
);

/** When someone last opened a file, for Recent. */
export const docRecents = pgTable(
  "doc_recents",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => docFiles.id, { onDelete: "cascade" }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.fileId] }), index("doc_recents_user_idx").on(t.orgId, t.userId, t.openedAt)],
);

/** Comment threads on a written document: the root holds the quoted text, replies hang off it. */
export const docComments = pgTable(
  "doc_comments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => docFiles.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    quote: text("quote").notNull().default(""),
    /** Where the thread sits: Yjs relative positions (base64) of the quoted text's start and end, so it follows edits without changing the document. */
    anchor: jsonb("anchor").$type<{ from: string; to: string }>(),
    body: text("body").notNull(),
    mentions: uuid("mentions").array().notNull().default(sql`'{}'::uuid[]`),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
  },
  (t) => [index("doc_comments_file_idx").on(t.fileId, t.createdAt)],
);

/** Live co-editing of a written document: Yjs updates and cursors, relayed through Postgres. */
export const docLiveUpdates = pgTable(
  "doc_live_updates",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    fileId: uuid("file_id").notNull().references(() => docFiles.id, { onDelete: "cascade" }),
    /** doc: a Yjs update · awareness: cursors (pruned quickly) · reset: the content was replaced */
    kind: text("kind").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id"),
    update: bytea("update").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("doc_live_updates_file_idx").on(t.fileId, t.seq)],
);

/** Images placed in a written document, served to whoever can open it. */
export const docAssets = pgTable(
  "doc_assets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => docFiles.id, { onDelete: "cascade" }),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("doc_assets_file_idx").on(t.fileId)],
);

/** What happened to a file, for its activity panel. */
export const docActivity = pgTable(
  "doc_activity",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").references(() => docFiles.id, { onDelete: "cascade" }),
    folderId: uuid("folder_id"),
    actorId: uuid("actor_id"),
    kind: text("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("doc_activity_file_idx").on(t.fileId, t.at), index("doc_activity_org_idx").on(t.orgId, t.at)],
);

export const docVersions = pgTable(
  "doc_versions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => docFiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("doc_versions_uq").on(t.fileId, t.version)],
);

export const docContracts = pgTable(
  "doc_contracts",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("customer"),
    counterparty: text("counterparty").notNull(),
    counterpartyEmail: text("counterparty_email").notNull().default(""),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    startOn: date("start_on"),
    endOn: date("end_on"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    renewalMonths: integer("renewal_months").notNull().default(12),
    noticeDays: integer("notice_days").notNull().default(30),
    /** draft | review | approved | signing | signed | terminated */
    status: text("status").notNull().default("draft"),
    fileId: uuid("file_id").references(() => docFiles.id, { onDelete: "set null" }),
    linkType: text("link_type"),
    linkId: uuid("link_id"),
    obligations: jsonb("obligations").$type<{ id: string; text: string; due: string | null; ownerId: string | null; done: boolean }[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    terminatedOn: date("terminated_on"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("doc_contracts_number_uq").on(t.orgId, t.number), index("doc_contracts_org_idx").on(t.orgId, t.status)],
);

/** A file sent for signature; the exact version and its SHA-256 are what's signed. */
export const docSignRequests = pgTable(
  "doc_sign_requests",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => docFiles.id, { onDelete: "cascade" }),
    versionId: uuid("version_id").notNull().references(() => docVersions.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    contractId: uuid("contract_id").references(() => docContracts.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    message: text("message").notNull().default(""),
    sequential: boolean("sequential").notNull().default(true),
    /** sent | completed | declined | voided | expired */
    status: text("status").notNull().default("sent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    certificate: bytea("certificate"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("doc_sign_requests_org_idx").on(t.orgId, t.status)],
);

export const docSigners = pgTable(
  "doc_signers",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => docSignRequests.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    order: integer("order").notNull(),
    /** The signing link's secret, hashed; the link itself is only ever shown when made. */
    tokenHash: text("token_hash"),
    /** waiting | sent | viewed | signed | declined */
    status: text("status").notNull().default("waiting"),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedName: text("signed_name"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    declineReason: text("decline_reason"),
  },
  (t) => [index("doc_signers_request_idx").on(t.requestId), uniqueIndex("doc_signers_token_uq").on(t.tokenHash)],
);

export const docSignEvents = pgTable(
  "doc_sign_events",
  {
    id: id(),
    requestId: uuid("request_id").notNull().references(() => docSignRequests.id, { onDelete: "cascade" }),
    signerId: uuid("signer_id"),
    kind: text("kind").notNull(),
    detail: text("detail").notNull().default(""),
    ip: text("ip"),
    userAgent: text("user_agent"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("doc_sign_events_request_idx").on(t.requestId, t.at)],
);

// ─── Marketing (module "marketing") ─────────────────────────────────────────

export const mktSettings = pgTable("mkt_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
});

export const mktSegments = pgTable(
  "mkt_segments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rules: jsonb("rules").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("mkt_segments_org_idx").on(t.orgId)],
);

export const mktCampaigns = pgTable(
  "mkt_campaigns",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** email | event | ads | other */
    kind: text("kind").notNull().default("email"),
    /** draft | scheduled | sending | sent | active | ended | cancelled */
    status: text("status").notNull().default("draft"),
    segmentId: uuid("segment_id").references(() => mktSegments.id, { onDelete: "set null" }),
    subject: text("subject").notNull().default(""),
    subjectB: text("subject_b").notNull().default(""),
    body: text("body").notNull().default(""),
    /** The links in the body when it was sent; tracked links point at these by position. */
    links: jsonb("links").$type<string[]>().notNull().default([]),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    budget: bigint("budget", { mode: "number" }).notNull().default(0),
    spend: bigint("spend", { mode: "number" }).notNull().default(0),
    /** utm_campaign for links and forms that bring people in. */
    slug: text("slug").notNull(),
    startOn: date("start_on"),
    endOn: date("end_on"),
    eventAt: timestamp("event_at", { withTimezone: true }),
    venue: text("venue").notNull().default(""),
    onlineUrl: text("online_url").notNull().default(""),
    capacity: integer("capacity").notNull().default(0),
    /** The public registration page's token. */
    regToken: text("reg_token"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mkt_campaigns_slug_uq").on(t.orgId, t.slug), uniqueIndex("mkt_campaigns_reg_uq").on(t.regToken), index("mkt_campaigns_org_idx").on(t.orgId, t.status)],
);

export const mktSends = pgTable(
  "mkt_sends",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => mktCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => crmContacts.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    variant: text("variant").notNull().default("A"),
    /** queued | sent | failed | skipped */
    status: text("status").notNull().default("queued"),
    reason: text("reason").notNull().default(""),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    clicks: integer("clicks").notNull().default(0),
    firstClickAt: timestamp("first_click_at", { withTimezone: true }),
    unsubscribedAt: timestamp("unsubscribed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("mkt_sends_uq").on(t.campaignId, t.contactId), index("mkt_sends_queue_idx").on(t.campaignId, t.status)],
);

export const mktClicks = pgTable(
  "mkt_clicks",
  {
    id: id(),
    sendId: uuid("send_id").notNull().references(() => mktSends.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => mktCampaigns.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mkt_clicks_campaign_idx").on(t.campaignId, t.url)],
);

export const mktRegistrations = pgTable(
  "mkt_registrations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => mktCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull().default(""),
    /** registered | attended | cancelled */
    status: text("status").notNull().default("registered"),
    attendedAt: timestamp("attended_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mkt_registrations_uq").on(t.campaignId, t.email)],
);

/** Every time a campaign reached a contact (sent, clicked, registered, attended, a form with its utm_campaign), for attribution. */
export const mktTouches = pgTable(
  "mkt_touches",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull().references(() => mktCampaigns.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => crmContacts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mkt_touches_contact_idx").on(t.orgId, t.contactId, t.at), index("mkt_touches_campaign_idx").on(t.campaignId)],
);

// ─── Logistics & fleet (module "logistics") ─────────────────────────────────

export const lgxSettings = pgTable("lgx_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const lgxDrivers = pgTable(
  "lgx_drivers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull().default(""),
    employeeId: uuid("employee_id"),
    licenceNo: text("licence_no").notNull().default(""),
    licenceExpires: date("licence_expires"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("lgx_drivers_org_idx").on(t.orgId)],
);

export const lgxVehicles = pgTable(
  "lgx_vehicles",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    regNo: text("reg_no").notNull(),
    name: text("name").notNull().default(""),
    type: text("type").notNull().default("van"),
    ownership: text("ownership").notNull().default("own"),
    capacityKg: real("capacity_kg").notNull().default(0),
    fuel: text("fuel").notNull().default("diesel"),
    driverId: uuid("driver_id").references(() => lgxDrivers.id, { onDelete: "set null" }),
    /** Its asset in Assets & maintenance, so odometer readings feed servicing. */
    assetId: uuid("asset_id"),
    odometer: real("odometer"),
    odometerAt: date("odometer_at"),
    docs: jsonb("docs").$type<{ kind: string; number: string; expiresOn: string | null }[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lgx_vehicles_reg_uq").on(t.orgId, t.regNo)],
);

export const lgxCarriers = pgTable(
  "lgx_carriers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("transporter"),
    supplierId: uuid("supplier_id"),
    trackingUrl: text("tracking_url").notNull().default(""),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("lgx_carriers_org_idx").on(t.orgId)],
);

export const lgxRates = pgTable(
  "lgx_rates",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    carrierId: uuid("carrier_id").notNull().references(() => lgxCarriers.id, { onDelete: "cascade" }),
    fromState: text("from_state").notNull().default(""),
    toState: text("to_state").notNull().default(""),
    perKg: bigint("per_kg", { mode: "number" }).notNull().default(0),
    minCharge: bigint("min_charge", { mode: "number" }).notNull().default(0),
    fixed: bigint("fixed", { mode: "number" }).notNull().default(0),
    volumetricDivisor: integer("volumetric_divisor").notNull().default(0),
  },
  (t) => [index("lgx_rates_carrier_idx").on(t.carrierId)],
);

export const lgxTrips = pgTable(
  "lgx_trips",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    date: date("date").notNull(),
    vehicleId: uuid("vehicle_id").notNull().references(() => lgxVehicles.id, { onDelete: "cascade" }),
    driverId: uuid("driver_id").references(() => lgxDrivers.id, { onDelete: "set null" }),
    /** planned | started | completed | cancelled */
    status: text("status").notNull().default("planned"),
    startOdo: real("start_odo"),
    endOdo: real("end_odo"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    expenses: jsonb("expenses").$type<{ kind: string; amount: number; note: string }[]>().notNull().default([]),
    /** Where the trip's expenses were paid from, for the books. */
    paidFromId: uuid("paid_from_id"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lgx_trips_number_uq").on(t.orgId, t.number), index("lgx_trips_vehicle_idx").on(t.vehicleId, t.date)],
);

export const lgxShipments = pgTable(
  "lgx_shipments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    /** own (on a trip) | carrier */
    mode: text("mode").notNull().default("carrier"),
    carrierId: uuid("carrier_id").references(() => lgxCarriers.id, { onDelete: "set null" }),
    trackingNo: text("tracking_no").notNull().default(""),
    lrNo: text("lr_no").notNull().default(""),
    ewayBillNo: text("eway_bill_no").notNull().default(""),
    /** Sales delivery challans it carries. */
    deliveryIds: uuid("delivery_ids").array().notNull().default(sql`'{}'::uuid[]`),
    consignee: text("consignee").notNull(),
    phone: text("phone").notNull().default(""),
    address: text("address").notNull().default(""),
    state: text("state").notNull().default(""),
    warehouseId: uuid("warehouse_id"),
    weightKg: real("weight_kg").notNull().default(0),
    packages: integer("packages").notNull().default(1),
    dims: jsonb("dims").$type<{ l: number; w: number; h: number } | null>(),
    /** What the carriage costs us, and what we charge the customer, paise. */
    freightCost: bigint("freight_cost", { mode: "number" }).notNull().default(0),
    freightBilled: bigint("freight_billed", { mode: "number" }).notNull().default(0),
    freightPaidFromId: uuid("freight_paid_from_id"),
    freightPaidOn: date("freight_paid_on"),
    /** planned | picked | in_transit | out_for_delivery | delivered | exception | returned | cancelled */
    status: text("status").notNull().default("planned"),
    promisedOn: date("promised_on"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    podName: text("pod_name").notNull().default(""),
    podNote: text("pod_note").notNull().default(""),
    events: jsonb("events").$type<{ at: string; status: string; note: string; by: string | null }[]>().notNull().default([]),
    /** The public tracking page's token. */
    trackToken: text("track_token").notNull(),
    tripId: uuid("trip_id").references(() => lgxTrips.id, { onDelete: "set null" }),
    stopOrder: integer("stop_order").notNull().default(0),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lgx_shipments_number_uq").on(t.orgId, t.number), uniqueIndex("lgx_shipments_track_uq").on(t.trackToken), index("lgx_shipments_org_idx").on(t.orgId, t.status), index("lgx_shipments_trip_idx").on(t.tripId)],
);

export const lgxFuel = pgTable(
  "lgx_fuel",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").notNull().references(() => lgxVehicles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    litres: real("litres").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    odometer: real("odometer").notNull(),
    full: boolean("full").notNull().default(true),
    station: text("station").notNull().default(""),
    paidFromId: uuid("paid_from_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("lgx_fuel_vehicle_idx").on(t.vehicleId, t.odometer)],
);

// ─── Reports & dashboards (module "bi") ─────────────────────────────────────

export const biReports = pgTable(
  "bi_reports",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    dataset: text("dataset").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    /** Seen by the team, or only by whoever made it. */
    shared: boolean("shared").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bi_reports_org_idx").on(t.orgId)],
);

export const biDashboards = pgTable(
  "bi_dashboards",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    widgets: jsonb("widgets").$type<{ id: string; reportId: string; size: string; target: number | null }[]>().notNull().default([]),
    shared: boolean("shared").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("bi_dashboards_org_idx").on(t.orgId)],
);

export const biSchedules = pgTable(
  "bi_schedules",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull().references(() => biReports.id, { onDelete: "cascade" }),
    frequency: text("frequency").notNull().default("weekly"),
    hour: integer("hour").notNull().default(9),
    weekday: integer("weekday").notNull().default(1),
    monthday: integer("monthday").notNull().default(1),
    recipients: uuid("recipients").array().notNull().default(sql`'{}'::uuid[]`),
    active: boolean("active").notNull().default(true),
    nextAt: timestamp("next_at", { withTimezone: true }).notNull(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastError: text("last_error").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("bi_schedules_due_idx").on(t.active, t.nextAt)],
);

// ─── Helpdesk (module "helpdesk") ───────────────────────────────────────────

export const hdSettings = pgTable("hd_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
  /** In the inbound email address (…/helpdesk/inbound/:token); changing it stops the old one. */
  inboundToken: text("inbound_token").notNull(),
  /** { ticket: next number, rr: round-robin position } */
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const hdTickets = pgTable(
  "hd_tickets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    subject: text("subject").notNull(),
    /** new | open | pending | on_hold | resolved | closed */
    status: text("status").notNull().default("new"),
    priority: text("priority").notNull().default("normal"),
    channel: text("channel").notNull().default("manual"),
    customerName: text("customer_name").notNull().default(""),
    customerEmail: text("customer_email").notNull().default(""),
    customerPhone: text("customer_phone").notNull().default(""),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    firstResponseDue: timestamp("first_response_due", { withTimezone: true }),
    resolveDue: timestamp("resolve_due", { withTimezone: true }),
    firstRespondedAt: timestamp("first_responded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** While waiting on the customer or on hold: when it paused, and the business minutes left to resolve. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    remainingMins: integer("remaining_mins"),
    firstBreached: boolean("first_breached").notNull().default(false),
    resolveBreached: boolean("resolve_breached").notNull().default(false),
    csat: integer("csat"),
    csatComment: text("csat_comment").notNull().default(""),
    lastCustomerAt: timestamp("last_customer_at", { withTimezone: true }),
    lastAgentAt: timestamp("last_agent_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hd_tickets_number_uq").on(t.orgId, t.number), index("hd_tickets_status_idx").on(t.orgId, t.status), index("hd_tickets_email_idx").on(t.orgId, sql`lower(${t.customerEmail})`)],
);

export const hdMessages = pgTable(
  "hd_messages",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id").notNull().references(() => hdTickets.id, { onDelete: "cascade" }),
    /** customer | reply | note (internal) | event */
    kind: text("kind").notNull(),
    body: text("body").notNull(),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    fromName: text("from_name").notNull().default(""),
    fromEmail: text("from_email").notNull().default(""),
    /** The email's Message-ID, so a redelivered email isn't added twice. */
    emailId: text("email_id"),
    createdAt: createdAt(),
  },
  (t) => [index("hd_messages_ticket_idx").on(t.ticketId, t.createdAt), uniqueIndex("hd_messages_email_uq").on(t.orgId, t.emailId).where(sql`${t.emailId} is not null`)],
);

export const hdCanned = pgTable("hd_canned", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ─── Education (module "education") ─────────────────────────────────────────

export const eduSettings = pgTable("edu_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const eduClasses = pgTable("edu_classes", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  section: text("section").notNull().default(""),
  year: text("year").notNull(),
  teacherId: uuid("teacher_id").references(() => users.id, { onDelete: "set null" }),
  capacity: integer("capacity").notNull().default(0),
  createdAt: createdAt(),
});

export const eduStudents = pgTable(
  "edu_students",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    admissionNo: text("admission_no").notNull(),
    name: text("name").notNull(),
    dob: date("dob"),
    gender: text("gender").notNull().default(""),
    classId: uuid("class_id").references(() => eduClasses.id, { onDelete: "set null" }),
    rollNo: integer("roll_no"),
    guardianName: text("guardian_name").notNull().default(""),
    guardianPhone: text("guardian_phone").notNull().default(""),
    guardianEmail: text("guardian_email").notNull().default(""),
    address: text("address").notNull().default(""),
    concessionPct: real("concession_pct").notNull().default(0),
    concessionNote: text("concession_note").notNull().default(""),
    status: text("status").notNull().default("active"),
    joinedOn: date("joined_on"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("edu_students_adm_uq").on(t.orgId, t.admissionNo), index("edu_students_class_idx").on(t.classId)],
);

export const eduFeePlans = pgTable("edu_fee_plans", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  year: text("year").notNull(),
  classIds: jsonb("class_ids").$type<string[]>().notNull().default([]),
  heads: jsonb("heads").$type<{ name: string; amount: number; concession: boolean }[]>().notNull().default([]),
  installments: jsonb("installments").$type<{ label: string; dueDate: string; pct: number }[]>().notNull().default([]),
  gstRate: real("gst_rate").notNull().default(0),
  createdAt: createdAt(),
});

/** One instalment of a plan for one student. Amounts in paise; tax on top. */
export const eduFees = pgTable(
  "edu_fees",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    studentId: uuid("student_id").notNull().references(() => eduStudents.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => eduFeePlans.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    dueDate: date("due_date").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    tax: bigint("tax", { mode: "number" }).notNull().default(0),
    paid: bigint("paid", { mode: "number" }).notNull().default(0),
    /** due | partial | paid | waived */
    status: text("status").notNull().default("due"),
    waivedReason: text("waived_reason").notNull().default(""),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("edu_fees_number_uq").on(t.orgId, t.number), uniqueIndex("edu_fees_once_uq").on(t.studentId, t.planId, t.label), index("edu_fees_due_idx").on(t.orgId, t.status, t.dueDate)],
);

export const eduPayments = pgTable("edu_payments", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  feeId: uuid("fee_id").notNull().references(() => eduFees.id, { onDelete: "cascade" }),
  receiptNo: text("receipt_no").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(),
  method: text("method").notNull(),
  paidOn: date("paid_on").notNull(),
  reference: text("reference").notNull().default(""),
  accountId: uuid("account_id").references(() => accAccounts.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const eduAttendance = pgTable(
  "edu_attendance",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => eduStudents.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    status: text("status").notNull(),
    markedBy: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.date] }), index("edu_attendance_org_idx").on(t.orgId, t.date)],
);

export const eduExams = pgTable("edu_exams", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  classId: uuid("class_id").notNull().references(() => eduClasses.id, { onDelete: "cascade" }),
  date: date("date"),
  subjects: jsonb("subjects").$type<{ name: string; max: number }[]>().notNull().default([]),
  createdAt: createdAt(),
});

export const eduMarks = pgTable(
  "edu_marks",
  {
    examId: uuid("exam_id").notNull().references(() => eduExams.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").notNull().references(() => eduStudents.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    marks: real("marks"),
  },
  (t) => [primaryKey({ columns: [t.examId, t.studentId, t.subject] })],
);

// ─── Clinic (module "clinic") ───────────────────────────────────────────────

export const clinicSettings = pgTable("clinic_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const clinicPatients = pgTable(
  "clinic_patients",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    mrn: text("mrn").notNull(),
    name: text("name").notNull(),
    dob: date("dob"),
    ageYears: integer("age_years"),
    gender: text("gender").notNull().default(""),
    phone: text("phone").notNull().default(""),
    email: text("email").notNull().default(""),
    address: text("address").notNull().default(""),
    bloodGroup: text("blood_group").notNull().default(""),
    allergies: text("allergies").notNull().default(""),
    conditions: text("conditions").notNull().default(""),
    emergencyName: text("emergency_name").notNull().default(""),
    emergencyPhone: text("emergency_phone").notNull().default(""),
    consentAt: timestamp("consent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("clinic_patients_mrn_uq").on(t.orgId, t.mrn), index("clinic_patients_phone_idx").on(t.orgId, t.phone)],
);

export const clinicAppointments = pgTable(
  "clinic_appointments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull().references(() => clinicPatients.id, { onDelete: "cascade" }),
    doctorId: uuid("doctor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    time: text("time"),
    minutes: integer("minutes").notNull().default(15),
    type: text("type").notNull().default("consultation"),
    reason: text("reason").notNull().default(""),
    /** Queue number for this doctor and day. */
    token: integer("token").notNull(),
    status: text("status").notNull().default("booked"),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("clinic_appointments_token_uq").on(t.doctorId, t.date, t.token), index("clinic_appointments_day_idx").on(t.orgId, t.date)],
);

export const clinicVisits = pgTable(
  "clinic_visits",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull().references(() => clinicPatients.id, { onDelete: "cascade" }),
    appointmentId: uuid("appointment_id").references(() => clinicAppointments.id, { onDelete: "set null" }),
    doctorId: uuid("doctor_id").references(() => users.id, { onDelete: "set null" }),
    vitals: jsonb("vitals").notNull().default({}),
    complaints: text("complaints").notNull().default(""),
    findings: text("findings").notNull().default(""),
    diagnosis: text("diagnosis").notNull().default(""),
    icd10: text("icd10").notNull().default(""),
    prescription: jsonb("prescription").$type<{ drug: string; strength: string; dose: string; days: number; instructions: string }[]>().notNull().default([]),
    advice: text("advice").notNull().default(""),
    tests: text("tests").notNull().default(""),
    followUp: date("follow_up"),
    /** Signed visits can't be edited — only added to. */
    signedAt: timestamp("signed_at", { withTimezone: true }),
    addenda: jsonb("addenda").$type<{ at: string; by: string; text: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("clinic_visits_patient_idx").on(t.patientId, t.createdAt)],
);

export const clinicBills = pgTable(
  "clinic_bills",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    patientId: uuid("patient_id").notNull().references(() => clinicPatients.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").references(() => clinicVisits.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    items: jsonb("items").$type<{ name: string; qty: number; rate: number }[]>().notNull().default([]),
    discount: bigint("discount", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull(),
    paid: bigint("paid", { mode: "number" }).notNull().default(0),
    /** due | partial | paid | void */
    status: text("status").notNull().default("due"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("clinic_bills_number_uq").on(t.orgId, t.number)],
);

export const clinicPayments = pgTable("clinic_payments", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  billId: uuid("bill_id").notNull().references(() => clinicBills.id, { onDelete: "cascade" }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  method: text("method").notNull(),
  paidOn: date("paid_on").notNull(),
  reference: text("reference").notNull().default(""),
  accountId: uuid("account_id").references(() => accAccounts.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

// ─── Construction (module "construction") ───────────────────────────────────

export const conContracts = pgTable("con_contracts", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  client: text("client").notNull(),
  clientGstin: text("client_gstin").notNull().default(""),
  workOrderNo: text("work_order_no").notNull().default(""),
  site: text("site").notNull().default(""),
  startDate: date("start_date"),
  endDate: date("end_date"),
  retentionPct: real("retention_pct").notNull().default(5),
  advancePct: real("advance_pct").notNull().default(10),
  gstRate: real("gst_rate").notNull().default(18),
  interState: boolean("inter_state").notNull().default(false),
  tdsPct: real("tds_pct").notNull().default(2),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
});

export const conBoq = pgTable(
  "con_boq",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull().references(() => conContracts.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    description: text("description").notNull(),
    unit: text("unit").notNull(),
    qty: real("qty").notNull(),
    /** Paise per unit. */
    rate: bigint("rate", { mode: "number" }).notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("con_boq_code_uq").on(t.contractId, t.code)],
);

export const conMeasurements = pgTable(
  "con_measurements",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull().references(() => conContracts.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => conBoq.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    location: text("location").notNull().default(""),
    nos: real("nos").notNull().default(1),
    length: real("length"),
    breadth: real("breadth"),
    depth: real("depth"),
    qty: real("qty").notNull(),
    remarks: text("remarks").notNull().default(""),
    /** The RA bill that took it in (measurements in a bill can't change). */
    billId: uuid("bill_id"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    checkedBy: uuid("checked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("con_measurements_item_idx").on(t.itemId, t.date)],
);

export const conBills = pgTable(
  "con_bills",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull().references(() => conContracts.id, { onDelete: "cascade" }),
    /** RA-1, RA-2… within the contract. */
    seq: integer("seq").notNull(),
    upTo: date("up_to").notNull(),
    lines: jsonb("lines").$type<{ itemId: string; code: string; description: string; unit: string; rate: number; boqQty: number; upto: number; prev: number; qty: number; amount: number; excess: boolean }[]>().notNull().default([]),
    gross: bigint("gross", { mode: "number" }).notNull(),
    retention: bigint("retention", { mode: "number" }).notNull(),
    advance: bigint("advance", { mode: "number" }).notNull(),
    gst: bigint("gst", { mode: "number" }).notNull(),
    tds: bigint("tds", { mode: "number" }).notNull(),
    net: bigint("net", { mode: "number" }).notNull(),
    received: bigint("received", { mode: "number" }).notNull().default(0),
    /** draft | submitted | certified | paid */
    status: text("status").notNull().default("draft"),
    certifiedOn: date("certified_on"),
    clientRef: text("client_ref").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("con_bills_seq_uq").on(t.contractId, t.seq)],
);

export const conPayments = pgTable("con_payments", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  contractId: uuid("contract_id").notNull().references(() => conContracts.id, { onDelete: "cascade" }),
  /** bill | advance | retention */
  kind: text("kind").notNull(),
  billId: uuid("bill_id").references(() => conBills.id, { onDelete: "set null" }),
  amount: bigint("amount", { mode: "number" }).notNull(),
  date: date("date").notNull(),
  reference: text("reference").notNull().default(""),
  accountId: uuid("account_id").references(() => accAccounts.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const conDiary = pgTable(
  "con_diary",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id").notNull().references(() => conContracts.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    weather: text("weather").notNull().default(""),
    labour: jsonb("labour").$type<{ trade: string; count: number }[]>().notNull().default([]),
    work: text("work").notNull(),
    hindrances: text("hindrances").notNull().default(""),
    visitors: text("visitors").notNull().default(""),
    by: uuid("by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("con_diary_day_uq").on(t.contractId, t.date)],
);

// ─── Platform: SSO, SCIM, sign-ins, flags, support, exports ─────────────────

/** A workspace's OpenID Connect sign-in. */
export const ssoConnections = pgTable("sso_connections", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  issuer: text("issuer").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Members with a verified domain's email must sign in through SSO. */
  enforce: boolean("enforce").notNull().default(false),
  /** Role for someone signing in through SSO for the first time. */
  jitRole: text("jit_role").notNull().default("viewer"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** An email domain a workspace has proven it owns (by a DNS TXT record). One workspace per verified domain. */
export const ssoDomains = pgTable(
  "sso_domains",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    token: text("token").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sso_domains_org_uq").on(t.orgId, t.domain), uniqueIndex("sso_domains_verified_uq").on(t.domain).where(sql`${t.verifiedAt} is not null`)],
);

export const scimTokens = pgTable("scim_tokens", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  prefix: text("prefix").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Every sign-in attempt: who, how, from where, and whether it worked. */
export const loginEvents = pgTable(
  "login_events",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull().default(""),
    ok: boolean("ok").notNull(),
    /** password | mfa | github | sso */
    method: text("method").notNull(),
    reason: text("reason").notNull().default(""),
    ip: text("ip"),
    userAgent: text("user_agent"),
    newDevice: boolean("new_device").notNull().default(false),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_events_user_idx").on(t.userId, t.at), index("login_events_at_idx").on(t.at)],
);

/** Release flags: off, on for everyone, or on for chosen workspaces. */
/** Platform-wide settings set from the admin console, one row per section (general, signup, security…). */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Integration settings set from the admin console (API keys etc.), AES-GCM encrypted. Environment variables take precedence. */
export const platformConfig = pgTable("platform_config", {
  key: text("key").primaryKey(),
  valueEnc: text("value_enc").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Shared rate-limit counters so limits hold across every server (unlogged: fast, rebuilt empty after a crash). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (t) => [index("rate_limits_reset_idx").on(t.resetAt)]);

/** Request metrics per minute, per server and API area: volume, errors and a latency histogram. */
export const requestStats = pgTable("request_stats", {
  bucket: timestamp("bucket", { withTimezone: true }).notNull(),
  node: text("node").notNull(),
  area: text("area").notNull(),
  count: integer("count").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  clientErrors: integer("client_errors").notNull().default(0),
  totalMs: bigint("total_ms", { mode: "number" }).notNull().default(0),
  maxMs: integer("max_ms").notNull().default(0),
  /** Counts per latency bucket: ≤25, 50, 100, 250, 500, 1000, 2500, 5000 ms, and slower. */
  hist: integer("hist").array().notNull(),
}, (t) => [primaryKey({ columns: [t.bucket, t.node, t.area] }), index("request_stats_bucket_idx").on(t.bucket)]);

/** One value per day per metric (database size, table sizes, totals) for growth trends and capacity projections. */
export const platformSnapshots = pgTable("platform_snapshots", {
  day: text("day").notNull(),
  key: text("key").notNull(),
  value: bigint("value", { mode: "number" }).notNull(),
}, (t) => [primaryKey({ columns: [t.day, t.key] })]);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull().default(""),
  enabled: boolean("enabled").notNull().default(false),
  orgIds: jsonb("org_ids").$type<string[]>().notNull().default([]),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A workspace owner letting platform support look at their workspace, for a limited time. */
export const supportGrants = pgTable("support_grants", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
  reason: text("reason").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** A full export of a workspace's data, made in the background and downloaded by an owner. */
export const orgExports = pgTable("org_exports", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
  /** queued | done | failed */
  status: text("status").notNull().default("queued"),
  bytes: bytea("bytes"),
  size: integer("size").notNull().default(0),
  tables: integer("tables").notNull().default(0),
  rows: integer("rows").notNull().default(0),
  error: text("error").notNull().default(""),
  createdAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

// ─── Integration hub (workspace) ────────────────────────────────────────────

/** Workspace webhooks for ERP events. */
export const orgWebhooks = pgTable("org_webhooks", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  description: text("description").notNull().default(""),
  events: jsonb("events").$type<string[]>().notNull().default([]),
  secretEnc: text("secret_enc").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  /** Failed deliveries in a row; reset by any success. */
  failures: integer("failures").notNull().default(0),
  disabledReason: text("disabled_reason").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const orgWebhookDeliveries = pgTable(
  "org_webhook_deliveries",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull().references(() => orgWebhooks.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    /** pending | succeeded | failed (will retry) | dead */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseStatus: integer("response_status"),
    responseBody: text("response_body"),
    error: text("error"),
    createdAt: createdAt(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [index("org_webhook_deliveries_idx").on(t.orgId, t.endpointId, t.createdAt), index("org_webhook_deliveries_status_idx").on(t.orgId, t.status)],
);

/** Keys for the workspace's ERP API. Only the hash is kept; the key is shown once. */
export const orgApiKeys = pgTable(
  "org_api_keys",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("org_api_keys_hash_uq").on(t.keyHash)],
);

/** One line per API call, kept 30 days, for the usage view. */
export const orgApiCalls = pgTable(
  "org_api_calls",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    keyId: uuid("key_id").references(() => orgApiKeys.id, { onDelete: "set null" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    version: text("version").notNull(),
    ms: integer("ms").notNull().default(0),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("org_api_calls_idx").on(t.orgId, t.at)],
);

// ─── Master data & migration (workspace settings) ──────────────────────────

export const dataSettings = pgTable("data_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  /** { exports: "everyone" | "team" | "managers" } */
  settings: jsonb("settings").notNull().default({}),
});

/** Every import someone ran: what, from which file, what happened to each row, and money totals to reconcile. */
export const importRuns = pgTable(
  "import_runs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    target: text("target").notNull(),
    fileName: text("file_name").notNull().default(""),
    mode: text("mode").notNull().default(""),
    rows: integer("rows").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    /** The first 500 rows that failed, with why and the row as sent. */
    errors: jsonb("errors").$type<{ row: number; message: string; data: Record<string, unknown> }[]>().notNull().default([]),
    /** Sums of money and number columns: in the file, and in rows that were saved. */
    totals: jsonb("totals").$type<Record<string, { label: string; file: number; saved: number; money: boolean }>>().notNull().default({}),
    /** running | done */
    status: text("status").notNull().default("running"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("import_runs_org_idx").on(t.orgId, t.startedAt)],
);

/** A column mapping someone saved for a kind of file, applied again when the same headings come back. */
export const importMappings = pgTable(
  "import_mappings",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    target: text("target").notNull(),
    name: text("name").notNull(),
    headers: jsonb("headers").$type<string[]>().notNull(),
    /** heading (as in the file) → field key, or null to ignore */
    mapping: jsonb("mapping").$type<Record<string, string | null>>().notNull(),
    constants: jsonb("constants").$type<Record<string, string>>().notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("import_mappings_name_uq").on(t.orgId, t.target, t.name)],
);

// ─── Governance, risk & compliance (module "grc") ───────────────────────────

export const grcSettings = pgTable("grc_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
  /** { risk, incident, audit } next numbers */
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const grcControls = pgTable(
  "grc_controls",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull().default("preventive"),
    frequency: text("frequency").notNull().default("quarterly"),
    nextTestDue: date("next_test_due"),
    /** effective | partly | ineffective, from the latest test */
    lastResult: text("last_result"),
    lastTestedOn: date("last_tested_on"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("grc_controls_code_uq").on(t.orgId, sql`upper(${t.code})`)],
);

export const grcControlTests = pgTable("grc_control_tests", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  controlId: uuid("control_id").notNull().references(() => grcControls.id, { onDelete: "cascade" }),
  testedOn: date("tested_on").notNull(),
  result: text("result").notNull(),
  notes: text("notes").notNull().default(""),
  documentId: uuid("document_id").references(() => docFiles.id, { onDelete: "set null" }),
  testedBy: uuid("tested_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const grcRisks = pgTable(
  "grc_risks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull().default("operational"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    likelihood: integer("likelihood").notNull(),
    impact: integer("impact").notNull(),
    residualLikelihood: integer("residual_likelihood"),
    residualImpact: integer("residual_impact"),
    treatment: text("treatment").notNull().default("reduce"),
    plan: text("plan").notNull().default(""),
    status: text("status").notNull().default("open"),
    reviewDate: date("review_date"),
    controlIds: jsonb("control_ids").$type<string[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("grc_risks_number_uq").on(t.orgId, t.number)],
);

export const grcObligations = pgTable("grc_obligations", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  authority: text("authority").notNull().default(""),
  category: text("category").notNull().default("other"),
  recurrence: jsonb("recurrence").notNull(),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  remindDays: integer("remind_days").notNull().default(5),
  notes: text("notes").notNull().default(""),
  /** The starting-pack entry it came from, so the pack isn't added twice. */
  packKey: text("pack_key"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

/** One due date of an obligation: done (with a reference), waived, or still to do. */
export const grcFilings = pgTable(
  "grc_filings",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    obligationId: uuid("obligation_id").notNull().references(() => grcObligations.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    label: text("label").notNull().default(""),
    dueDate: date("due_date").notNull(),
    /** pending | done | waived */
    status: text("status").notNull().default("pending"),
    reference: text("reference").notNull().default(""),
    note: text("note").notNull().default(""),
    documentId: uuid("document_id").references(() => docFiles.id, { onDelete: "set null" }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneBy: uuid("done_by").references(() => users.id, { onDelete: "set null" }),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("grc_filings_period_uq").on(t.obligationId, t.period), index("grc_filings_due_idx").on(t.orgId, t.status, t.dueDate)],
);

export const grcPolicies = pgTable("grc_policies", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  version: integer("version").notNull().default(1),
  /** draft | published | retired */
  status: text("status").notNull().default("draft"),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  effectiveDate: date("effective_date"),
  reviewDate: date("review_date"),
  audience: jsonb("audience").$type<string[]>().notNull().default([]),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const grcPolicyAcks = pgTable(
  "grc_policy_acks",
  {
    policyId: uuid("policy_id").notNull().references(() => grcPolicies.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.policyId, t.version, t.userId] })],
);

export const grcIncidents = pgTable(
  "grc_incidents",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    description: text("description").notNull(),
    personalData: boolean("personal_data").notNull().default(false),
    status: text("status").notNull().default("open"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    rootCause: text("root_cause").notNull().default(""),
    actions: text("actions").notNull().default(""),
    riskId: uuid("risk_id").references(() => grcRisks.id, { onDelete: "set null" }),
    reportedBy: uuid("reported_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("grc_incidents_number_uq").on(t.orgId, t.number)],
);

export const grcAudits = pgTable(
  "grc_audits",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    scope: text("scope").notNull().default(""),
    auditorId: uuid("auditor_id").references(() => users.id, { onDelete: "set null" }),
    periodFrom: date("period_from"),
    periodTo: date("period_to"),
    status: text("status").notNull().default("planned"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("grc_audits_number_uq").on(t.orgId, t.number)],
);

export const grcFindings = pgTable("grc_findings", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  auditId: uuid("audit_id").notNull().references(() => grcAudits.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  severity: text("severity").notNull().default("medium"),
  detail: text("detail").notNull().default(""),
  recommendation: text("recommendation").notNull().default(""),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  dueDate: date("due_date"),
  response: text("response").notNull().default(""),
  status: text("status").notNull().default("open"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Activity behind emissions: electricity, fuels — entered, or brought in from the Logistics fuel log. */
export const grcEsg = pgTable(
  "grc_esg",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    metric: text("metric").notNull(),
    quantity: real("quantity").notNull(),
    note: text("note").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("grc_esg_month_idx").on(t.orgId, t.month)],
);

// ─── Customer & supplier portals (module "portal") ──────────────────────────

export const portalSettings = pgTable("portal_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull().default({}),
});

/** A one-time sign-in link emailed to a customer or supplier (only its hash is kept). */
export const portalLinks = pgTable(
  "portal_links",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** customer | supplier */
    kind: text("kind").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("portal_links_token_uq").on(t.tokenHash)],
);

/** A signed-in portal visitor (the cookie holds the token; only its hash is kept). */
export const portalSessions = pgTable(
  "portal_sessions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("portal_sessions_token_uq").on(t.tokenHash), index("portal_sessions_org_idx").on(t.orgId, t.kind, t.email)],
);

/** An invoice a supplier sent through the portal, waiting for the accounts team to turn it into a bill. */
export const portalInvoices = pgTable(
  "portal_invoices",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").notNull().references(() => invSuppliers.id, { onDelete: "cascade" }),
    poId: uuid("po_id").references(() => invPurchaseOrders.id, { onDelete: "set null" }),
    invoiceNo: text("invoice_no").notNull(),
    date: date("date").notNull(),
    /** Total in paise, as the supplier states it. */
    amount: bigint("amount", { mode: "number" }).notNull(),
    note: text("note").notNull().default(""),
    filename: text("filename").notNull().default(""),
    mime: text("mime").notNull().default(""),
    bytes: bytea("bytes"),
    /** submitted | billed | rejected */
    status: text("status").notNull().default("submitted"),
    billId: uuid("bill_id").references(() => accBills.id, { onDelete: "set null" }),
    reason: text("reason").notNull().default(""),
    submittedBy: text("submitted_by").notNull(),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("portal_invoices_org_idx").on(t.orgId, t.status), uniqueIndex("portal_invoices_no_uq").on(t.orgId, t.supplierId, sql`upper(${t.invoiceNo})`).where(sql`${t.status} <> 'rejected'`)],
);

// ─── AI copilot (module "copilot") ──────────────────────────────────────────

/** A conversation with the copilot: the exact message history sent to the model (only ever appended to). */
export const copilotThreads = pgTable(
  "copilot_threads",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New conversation"),
    messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("copilot_threads_user_idx").on(t.orgId, t.userId, t.updatedAt)],
);

/** Something the copilot suggested doing; nothing happens until the person confirms it. */
export const copilotActions = pgTable(
  "copilot_actions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull().references(() => copilotThreads.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    summary: text("summary").notNull(),
    /** proposed | done | dismissed | failed */
    status: text("status").notNull().default("proposed"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    error: text("error").notNull().default(""),
    createdAt: createdAt(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [index("copilot_actions_thread_idx").on(t.threadId)],
);

/**
 * What the copilot knows beyond the records: the business's own notes and
 * documents (kind note | file, written by owners and admins, for everyone),
 * and facts it learned from one person's conversations (kind learned, theirs).
 */
export const copilotKnowledge = pgTable(
  "copilot_knowledge",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** note | file | learned */
    kind: text("kind").notNull(),
    /** Set for learned facts: only this person's conversations use them. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    body: text("body").notNull(),
    /** For files: the original file name. */
    source: text("source").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("copilot_knowledge_org_idx").on(t.orgId, t.kind)],
);

// ─── Approvals & notifications (platform) ────────────────────────────────────

/** Who has to approve what: a document kind, conditions (amount, department) and ordered steps. */
export const approvalPolicies = pgTable(
  "approval_policies",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    /** Lower runs first; the first matching policy applies. */
    priority: integer("priority").notNull().default(0),
    /** See conditionsSchema in lib/approvals/model. */
    conditions: jsonb("conditions").$type<Record<string, unknown>>().notNull().default({}),
    /** See stepSchema in lib/approvals/model. */
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approval_policies_org_idx").on(t.orgId, t.kind, t.priority)],
);

/** One document going through a policy: the steps are copied in, so editing the policy doesn't change requests in flight. */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    refId: text("ref_id").notNull(),
    label: text("label").notNull(),
    /** Minor units; what conditions and limits were checked against. */
    amount: bigint("amount", { mode: "number" }).notNull().default(0),
    requesterId: uuid("requester_id").references(() => users.id, { onDelete: "set null" }),
    departmentId: uuid("department_id"),
    policyId: uuid("policy_id").references(() => approvalPolicies.id, { onDelete: "set null" }),
    policyName: text("policy_name").notNull().default(""),
    policyVersion: integer("policy_version").notNull().default(1),
    steps: jsonb("steps").$type<unknown[]>().notNull().default([]),
    step: integer("step").notNull().default(0),
    stepStartedAt: timestamp("step_started_at", { withTimezone: true }).notNull().defaultNow(),
    escalatedStep: integer("escalated_step").notNull().default(-1),
    /** pending | approved | rejected | cancelled */
    status: text("status").notNull().default("pending"),
    /** What to do once approved, for documents that don't exist until then (a journal). */
    payload: jsonb("payload"),
    link: text("link").notNull().default(""),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("approval_requests_ref_idx").on(t.orgId, t.kind, t.refId), index("approval_requests_status_idx").on(t.orgId, t.status)],
);

export const approvalActions = pgTable(
  "approval_actions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    requestId: uuid("request_id").notNull().references(() => approvalRequests.id, { onDelete: "cascade" }),
    step: integer("step").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** The approver this person stood in for. */
    onBehalfOf: uuid("on_behalf_of").references(() => users.id, { onDelete: "set null" }),
    /** submitted | approved | rejected | escalated | cancelled | comment */
    action: text("action").notNull(),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("approval_actions_request_idx").on(t.requestId, t.createdAt)],
);

export const approvalDelegations = pgTable(
  "approval_delegations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    starts: date("starts").notNull(),
    ends: date("ends").notNull(),
    /** Kinds covered; empty means all. */
    kinds: text("kinds").array().notNull().default(sql`'{}'::text[]`),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("approval_delegations_to_idx").on(t.orgId, t.toUserId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link").notNull().default(""),
    readAt: timestamp("read_at", { withTimezone: true }),
    /** The email sent for it, if any (its delivery status lives on the outbox row). */
    emailId: uuid("email_id"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.orgId, t.createdAt)],
);

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** { [kind]: { app: boolean, email: boolean } } */
    prefs: jsonb("prefs").$type<Record<string, { app?: boolean; email?: boolean }>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

/** A workspace's own wording for a kind of notification ({{merge}} fields allowed). */
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.kind] })],
);

export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull(),
    title: text("title").notNull(),
    note: text("note").notNull().default(""),
    link: text("link").notNull().default(""),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("reminders_due_idx").on(t.sentAt, t.at)],
);

// ─── Organisation: companies, branches, centres, currencies, periods, groups ──

export const orgCompanies = pgTable(
  "org_companies",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    legalName: text("legal_name").notNull().default(""),
    gstin: text("gstin").notNull().default(""),
    pan: text("pan").notNull().default(""),
    cin: text("cin").notNull().default(""),
    /** Two-letter state code of the registered office. */
    state: text("state").notNull().default(""),
    address: text("address").notNull().default(""),
    baseCurrency: text("base_currency").notNull().default("INR"),
    isDefault: boolean("is_default").notNull().default(false),
    /** A parent in the group (for consolidation). */
    parentId: uuid("parent_id"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("org_companies_org_idx").on(t.orgId), uniqueIndex("org_companies_default_uq").on(t.orgId).where(sql`${t.isDefault}`)],
);

export const orgBranches = pgTable(
  "org_branches",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => orgCompanies.id, { onDelete: "restrict" }),
    /** A region above branches, or a branch above outlets. */
    parentId: uuid("parent_id"),
    code: text("code").notNull().default(""),
    name: text("name").notNull(),
    /** office | store | warehouse | plant | region | other */
    kind: text("kind").notNull().default("office"),
    state: text("state").notNull().default(""),
    address: text("address").notNull().default(""),
    /** A branch registered in another state has its own GSTIN. */
    gstin: text("gstin").notNull().default(""),
    managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("org_branches_org_idx").on(t.orgId, t.companyId)],
);

/** Cost centres, profit centres and business units: dimensions on ledger lines. */
export const orgUnits = pgTable(
  "org_units",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** cost_centre | profit_centre | business_unit */
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    companyId: uuid("company_id"),
    managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("org_units_code_uq").on(t.orgId, t.code)],
);

export const orgCurrencies = pgTable(
  "org_currencies",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull().default(""),
    decimals: integer("decimals").notNull().default(2),
    active: boolean("active").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.code] })],
);

/** Rupees per one unit of a currency, on a date. */
export const orgFxRates = pgTable(
  "org_fx_rates",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    currency: text("currency").notNull(),
    date: date("date").notNull(),
    rate: numeric("rate", { precision: 18, scale: 6 }).notNull(),
    /** manual | import */
    source: text("source").notNull().default("manual"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("org_fx_rates_uq").on(t.orgId, t.currency, t.date)],
);

/** Months closed in the books, per company (null company: all of them). */
export const accPeriods = pgTable(
  "acc_periods",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id"),
    month: text("month").notNull(),
    closedBy: uuid("closed_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note").notNull().default(""),
  },
  (t) => [uniqueIndex("acc_periods_uq").on(t.orgId, t.companyId, t.month)],
);

export const orgGroups = pgTable(
  "org_groups",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    members: uuid("members").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
  },
  (t) => [index("org_groups_org_idx").on(t.orgId)],
);

/** A completed review of who has access to what. */
export const accessReviews = pgTable(
  "access_reviews",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    /** What each member had when reviewed, and what was changed. */
    snapshot: jsonb("snapshot").notNull().default([]),
    changes: jsonb("changes").notNull().default([]),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("access_reviews_org_idx").on(t.orgId, t.createdAt)],
);

// ─── Finance: fixed assets, recurring entries, schedules, budgets (ERP phase C) ─

export const accAssets = pgTable(
  "acc_assets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id"),
    branchId: uuid("branch_id"),
    costCentreId: uuid("cost_centre_id"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull().default(""),
    /** Where its cost sits (a fixed-asset account). */
    assetAccountId: uuid("asset_account_id").notNull(),
    purchaseDate: date("purchase_date").notNull(),
    /** Depreciation runs from here. */
    inUseDate: date("in_use_date").notNull(),
    /** Paise. */
    cost: bigint("cost", { mode: "number" }).notNull(),
    residual: bigint("residual", { mode: "number" }).notNull().default(0),
    /** slm (straight line over its life) | wdv (a yearly rate on what's left) | none (land) */
    method: text("method").notNull().default("slm"),
    lifeMonths: integer("life_months").notNull().default(60),
    /** Yearly rate for wdv, in percent. */
    rate: real("rate").notNull().default(0),
    /** active | disposed */
    status: text("status").notNull().default("active"),
    disposedOn: date("disposed_on"),
    /** Paise received when sold or scrapped. */
    disposalAmount: bigint("disposal_amount", { mode: "number" }),
    /** The bank or cash account the money went into. */
    disposalAccountId: uuid("disposal_account_id"),
    /** The bill it was bought on, and the person who holds it (HR assets). */
    billId: uuid("bill_id"),
    holderId: uuid("holder_id"),
    serial: text("serial").notNull().default(""),
    location: text("location").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("acc_assets_code_uq").on(t.orgId, t.code), index("acc_assets_org_idx").on(t.orgId, t.status)],
);

/** Journals that repeat (rent accrued monthly) and spreads (a year's insurance paid up front). */
export const accSchedules = pgTable(
  "acc_schedules",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id"),
    /** recurring: the same journal every period. spread: a total split evenly over months from one account to another. */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** recurring: the journal lines. */
    lines: jsonb("lines").$type<{ accountId: string; debit: number; credit: number; description?: string; costCentreId?: string | null }[]>().notNull().default([]),
    /** month | quarter | year */
    every: text("every").notNull().default("month"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    /** recurring accruals: reverse on the first day of the next period. */
    autoReverse: boolean("auto_reverse").notNull().default(false),
    /** spread: the total, its months, and the two accounts. */
    total: bigint("total", { mode: "number" }).notNull().default(0),
    months: integer("months").notNull().default(0),
    fromAccountId: uuid("from_account_id"),
    toAccountId: uuid("to_account_id"),
    costCentreId: uuid("cost_centre_id"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("acc_schedules_org_idx").on(t.orgId, t.active)],
);

export const accBudgets = pgTable(
  "acc_budgets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "2026-27" */
    year: text("year").notNull(),
    companyId: uuid("company_id"),
    costCentreId: uuid("cost_centre_id"),
    /** { [accountId]: { [YYYY-MM]: paise } } */
    amounts: jsonb("amounts").$type<Record<string, Record<string, number>>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("acc_budgets_org_idx").on(t.orgId, t.year)],
);

// ─── Finance: TDS deposits, customer receipts, payment runs (ERP phase C2) ────

export const accTdsDeposits = pgTable(
  "acc_tds_deposits",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id"),
    date: date("date").notNull(),
    section: text("section").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** Paid from. */
    accountId: uuid("account_id").notNull(),
    challanNo: text("challan_no").notNull().default(""),
    bsrCode: text("bsr_code").notNull().default(""),
    /** "2026-27 Q2" */
    quarter: text("quarter").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("acc_tds_deposits_org_idx").on(t.orgId, t.quarter)],
);

/** Money received from a customer, spread over their invoices; what isn't used is an advance. */
export const accReceipts = pgTable(
  "acc_receipts",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    companyId: uuid("company_id"),
    number: text("number").notNull(),
    /** The invoicing books and client it's from. */
    ownerId: uuid("owner_id").notNull(),
    clientId: uuid("client_id"),
    clientName: text("client_name").notNull(),
    date: date("date").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    accountId: uuid("account_id").notNull(),
    reference: text("reference").notNull().default(""),
    /** [{ documentId, number, amount, paymentId }] */
    allocations: jsonb("allocations").$type<{ documentId: string; number: string; amount: number; paymentId: string }[]>().notNull().default([]),
    /** Kept as an advance (paise), and how much of it has since been used. */
    advance: bigint("advance", { mode: "number" }).notNull().default(0),
    advanceUsed: bigint("advance_used", { mode: "number" }).notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("acc_receipts_org_idx").on(t.orgId, t.date), index("acc_receipts_client_idx").on(t.ownerId, t.clientId)],
);

/** Bills chosen to pay together, approved, then paid from one account. */
export const accPaymentRuns = pgTable(
  "acc_payment_runs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    date: date("date").notNull(),
    accountId: uuid("account_id").notNull(),
    /** draft | pending_approval | approved | paid | cancelled */
    status: text("status").notNull().default("draft"),
    /** [{ billId, amount }] */
    items: jsonb("items").$type<{ billId: string; amount: number }[]>().notNull().default([]),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    note: text("note").notNull().default(""),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("acc_payment_runs_org_idx").on(t.orgId, t.status)],
);

/** Intercompany: one entry recorded in two companies of the workspace, each side tagged with the other. */
export const accIntercompany = pgTable(
  "acc_intercompany",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    date: date("date").notNull(),
    fromCompanyId: uuid("from_company_id").notNull(),
    toCompanyId: uuid("to_company_id").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    /** In the "from" company: credited (a bank paying on the other's behalf, or income for a recharge). */
    fromAccountId: uuid("from_account_id").notNull(),
    /** In the "to" company: debited (the cost it bears, or a bank receiving funds). */
    toAccountId: uuid("to_account_id").notNull(),
    narration: text("narration").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("acc_intercompany_org_idx").on(t.orgId, t.date)],
);

/** E-invoice (IRN) and e-way bill details for an invoice, entered after uploading the JSON on the government portals. */
export const accEinvoices = pgTable("acc_einvoices", {
  documentId: uuid("document_id").primaryKey().references(() => invoiceDocuments.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  irn: text("irn").notNull().default(""),
  ackNo: text("ack_no").notNull().default(""),
  ackDate: date("ack_date"),
  /** For the e-way bill: { mode, vehicleNo, vehicleType, distanceKm, transporterId, transporterName, transportDocNo, transportDocDate } */
  transport: jsonb("transport").$type<Record<string, unknown>>().notNull().default({}),
  ewbNo: text("ewb_no").notNull().default(""),
  ewbDate: date("ewb_date"),
  ewbValidTill: date("ewb_valid_till"),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Sales: orders, price lists, customer terms, delivery challans, returns, commissions ──

export const salesSettings = pgTable("sales_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  /** Numbering by kind: order, challan, return. */
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const salesPriceLists = pgTable(
  "sales_price_lists",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** fixed | discount */
    kind: text("kind").notNull().default("fixed"),
    discountPct: real("discount_pct").notNull().default(0),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("sales_price_lists_org_idx").on(t.orgId), uniqueIndex("sales_price_lists_default_uq").on(t.orgId).where(sql`${t.isDefault}`)],
);

export const salesPriceItems = pgTable(
  "sales_price_items",
  {
    id: id(),
    listId: uuid("list_id").notNull().references(() => salesPriceLists.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    price: bigint("price", { mode: "number" }).notNull(),
    minQty: qty("min_qty").notNull().default(0),
  },
  (t) => [uniqueIndex("sales_price_items_uq").on(t.listId, t.itemId, t.minQty)],
);

/** Terms for a customer (an invoicing client): price list, credit limit, payment terms, salesperson. */
export const salesCustomers = pgTable(
  "sales_customers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    clientId: uuid("client_id").notNull().references(() => invoiceClients.id, { onDelete: "cascade" }),
    priceListId: uuid("price_list_id"),
    creditLimit: bigint("credit_limit", { mode: "number" }).notNull().default(0),
    paymentTermsDays: integer("payment_terms_days").notNull().default(30),
    discountPct: real("discount_pct").notNull().default(0),
    salespersonId: uuid("salesperson_id"),
    onHold: boolean("on_hold").notNull().default(false),
    notes: text("notes").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sales_customers_client_uq").on(t.clientId), index("sales_customers_org_idx").on(t.orgId)],
);

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    ownerId: uuid("owner_id").notNull(),
    clientId: uuid("client_id").notNull(),
    clientName: text("client_name").notNull().default(""),
    date: date("date").notNull(),
    expectedDate: date("expected_date"),
    warehouseId: uuid("warehouse_id"),
    salespersonId: uuid("salesperson_id"),
    priceListId: uuid("price_list_id"),
    placeOfSupply: text("place_of_supply").notNull().default(""),
    reference: text("reference").notNull().default(""),
    dealId: uuid("deal_id"),
    /** [{ id, itemId, name, hsn, unit, qty, rate, listRate, discountPct, taxBps, delivered, invoiced, returned }] */
    lines: jsonb("lines").$type<{ id: string; itemId: string | null; name: string; hsn: string; unit: string; qty: number; rate: number; listRate: number; discountPct: number; taxBps: number; delivered: number; invoiced: number; returned: number }[]>().notNull().default([]),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    discount: bigint("discount", { mode: "number" }).notNull().default(0),
    tax: bigint("tax", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    /** draft | pending_approval | confirmed | partial | delivered | closed | cancelled */
    status: text("status").notNull().default("draft"),
    /** Why it needed approval. */
    holds: jsonb("holds").$type<string[]>().notNull().default([]),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sales_orders_org_idx").on(t.orgId, t.status), index("sales_orders_client_idx").on(t.clientId)],
);

export const salesDeliveries = pgTable(
  "sales_deliveries",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    orderId: uuid("order_id").notNull().references(() => salesOrders.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    lines: jsonb("lines").$type<{ lineId: string; itemId: string; name: string; qty: number; batch: string }[]>().notNull().default([]),
    vehicleNo: text("vehicle_no").notNull().default(""),
    transporter: text("transporter").notNull().default(""),
    /** dispatched | delivered | cancelled */
    status: text("status").notNull().default("dispatched"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    receivedBy: text("received_by").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("sales_deliveries_order_idx").on(t.orderId)],
);

export const salesReturns = pgTable(
  "sales_returns",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    orderId: uuid("order_id").notNull().references(() => salesOrders.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    warehouseId: uuid("warehouse_id"),
    lines: jsonb("lines").$type<{ lineId: string; itemId: string | null; name: string; qty: number; reason: string; restock: boolean }[]>().notNull().default([]),
    creditNoteId: uuid("credit_note_id"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("sales_returns_order_idx").on(t.orderId)],
);

/** Which invoice billed which quantities of an order, so a voided invoice frees them. */
export const salesOrderInvoices = pgTable(
  "sales_order_invoices",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").notNull().references(() => salesOrders.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id").notNull(),
    lines: jsonb("lines").$type<{ lineId: string; qty: number }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("sales_order_invoices_order_idx").on(t.orderId), index("sales_order_invoices_invoice_idx").on(t.invoiceId)],
);

export const salesCommissionPlans = pgTable("sales_commission_plans", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  userId: uuid("user_id"),
  ratePct: real("rate_pct").notNull(),
  /** invoiced | collected */
  basis: text("basis").notNull().default("invoiced"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const salesTargets = pgTable(
  "sales_targets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    month: text("month").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("sales_targets_uq").on(t.orgId, t.userId, t.month)],
);

// ── Procurement: requisitions, RFQs, supplier rates, returns, budgets ──

export const invRequisitions = pgTable(
  "inv_requisitions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    warehouseId: uuid("warehouse_id").notNull(),
    neededBy: date("needed_by"),
    /** [{ itemId, qty, estRate, note }] */
    lines: jsonb("lines").$type<{ itemId: string; qty: number; estRate: number; note: string }[]>().notNull().default([]),
    reason: text("reason").notNull().default(""),
    /** draft | pending_approval | approved | rejected | ordered | cancelled */
    status: text("status").notNull().default("draft"),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    /** POs or the RFQ it became. */
    poIds: jsonb("po_ids").$type<string[]>().notNull().default([]),
    rfqId: uuid("rfq_id"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inv_requisitions_org_idx").on(t.orgId, t.status)],
);

export const invRfqs = pgTable(
  "inv_rfqs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    title: text("title").notNull().default(""),
    warehouseId: uuid("warehouse_id").notNull(),
    dueDate: date("due_date"),
    lines: jsonb("lines").$type<{ itemId: string; qty: number }[]>().notNull().default([]),
    supplierIds: jsonb("supplier_ids").$type<string[]>().notNull().default([]),
    /** open | awarded | cancelled */
    status: text("status").notNull().default("open"),
    /** Which supplier got each item, and the POs made. */
    award: jsonb("award").$type<{ itemId: string; supplierId: string }[]>().notNull().default([]),
    poIds: jsonb("po_ids").$type<string[]>().notNull().default([]),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("inv_rfqs_org_idx").on(t.orgId, t.status)],
);

export const invRfqQuotes = pgTable(
  "inv_rfq_quotes",
  {
    id: id(),
    rfqId: uuid("rfq_id").notNull().references(() => invRfqs.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").notNull(),
    /** [{ itemId, rate, gstRate, leadDays }] — an item left out wasn't quoted. */
    lines: jsonb("lines").$type<{ itemId: string; rate: number; gstRate: number; leadDays: number }[]>().notNull().default([]),
    validTill: date("valid_till"),
    terms: text("terms").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inv_rfq_quotes_uq").on(t.rfqId, t.supplierId)],
);

/** Rate contracts: an agreed price for an item from a supplier, between dates. */
export const invSupplierRates = pgTable(
  "inv_supplier_rates",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").notNull().references(() => invSuppliers.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    rate: bigint("rate", { mode: "number" }).notNull(),
    minQty: qty("min_qty").notNull().default(0),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    reference: text("reference").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [index("inv_supplier_rates_idx").on(t.orgId, t.supplierId, t.itemId)],
);

/** Goods sent back to a supplier (rejected, damaged, excess). */
export const invSupplierReturns = pgTable(
  "inv_supplier_returns",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    supplierId: uuid("supplier_id").notNull(),
    receiptId: uuid("receipt_id"),
    warehouseId: uuid("warehouse_id").notNull(),
    date: date("date").notNull(),
    lines: jsonb("lines").$type<{ itemId: string; qty: number; rate: number; gstRate: number; batch: string; reason: string }[]>().notNull().default([]),
    subtotal: bigint("subtotal", { mode: "number" }).notNull().default(0),
    tax: bigint("tax", { mode: "number" }).notNull().default(0),
    total: bigint("total", { mode: "number" }).notNull().default(0),
    /** The debit note made in Accounts against the receipt's bill. */
    debitNoteId: uuid("debit_note_id"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("inv_supplier_returns_org_idx").on(t.orgId)],
);

/** What may be spent on purchases of a category in a month (before GST). */
export const invPurchaseBudgets = pgTable(
  "inv_purchase_budgets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    month: text("month").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
  },
  (t) => [uniqueIndex("inv_purchase_budgets_uq").on(t.orgId, t.category, t.month)],
);

// ── Warehouse: bins, reservations, serial numbers, waves ──

export const invBins = pgTable(
  "inv_bins",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => invWarehouses.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    zone: text("zone").notNull().default(""),
    /** storage | receiving | dispatch | quarantine — quarantined stock isn't available */
    kind: text("kind").notNull().default("storage"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inv_bins_code_uq").on(t.warehouseId, sql`lower(${t.code})`)],
);

/** Where in a location stock sits. What isn't in a bin is "not put away". */
export const invBinStock = pgTable(
  "inv_bin_stock",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    binId: uuid("bin_id").notNull().references(() => invBins.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    batch: text("batch").notNull().default(""),
    qty: qty("qty").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inv_bin_stock_uq").on(t.binId, t.itemId, t.batch)],
);

/** Stock promised to an order and not yet gone out. */
export const invReservations = pgTable(
  "inv_reservations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id").notNull(),
    qty: qty("qty").notNull(),
    /** sales_order */
    refType: text("ref_type").notNull(),
    refId: uuid("ref_id").notNull(),
    lineId: text("line_id").notNull().default(""),
    refNo: text("ref_no").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inv_reservations_uq").on(t.refType, t.refId, t.lineId), index("inv_reservations_item_idx").on(t.orgId, t.itemId, t.warehouseId)],
);

export const invSerials = pgTable(
  "inv_serials",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    serial: text("serial").notNull(),
    /** in_stock | delivered | returned_to_supplier | scrapped */
    status: text("status").notNull().default("in_stock"),
    warehouseId: uuid("warehouse_id"),
    /** Where it came from and last went: { type, id, no } */
    receivedRef: jsonb("received_ref").$type<{ type: string; id: string; no: string }>(),
    lastRef: jsonb("last_ref").$type<{ type: string; id: string; no: string }>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("inv_serials_uq").on(t.itemId, sql`lower(${t.serial})`), index("inv_serials_org_idx").on(t.orgId)],
);

/** A wave: several orders picked together from one location, packed and dispatched. */
export const invWaves = pgTable(
  "inv_waves",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    /** picking | packed | dispatched | cancelled */
    status: text("status").notNull().default("picking"),
    orderIds: jsonb("order_ids").$type<string[]>().notNull().default([]),
    /** [{ orderId, lineId, itemId, qty, picked, binId, batch, serials }] */
    lines: jsonb("lines").$type<{ orderId: string; lineId: string; itemId: string; qty: number; picked: number; binId: string | null; batch: string; serials: string[] }[]>().notNull().default([]),
    /** [{ orderId, boxes, weightKg }] */
    packages: jsonb("packages").$type<{ orderId: string; boxes: number; weightKg: number }[]>().notNull().default([]),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("inv_waves_org_idx").on(t.orgId, t.status)],
);

// ── Manufacturing: work centres, recipes (BOM + routing), work orders ──

export const mfgSettings = pgTable("mfg_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const mfgWorkCentres = pgTable(
  "mfg_work_centres",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    costPerHour: integer("cost_per_hour").notNull().default(0),
    hoursPerDay: real("hours_per_day").notNull().default(8),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("mfg_work_centres_code_uq").on(t.orgId, sql`lower(${t.code})`)],
);

export const mfgBoms = pgTable(
  "mfg_boms",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "cascade" }),
    name: text("name").notNull().default("Standard"),
    outputQty: qty("output_qty").notNull().default(1),
    lines: jsonb("lines").$type<{ itemId: string; qty: number; scrapPct: number }[]>().notNull().default([]),
    operations: jsonb("operations").$type<{ id: string; workCentreId: string; name: string; minutes: number; setupMinutes: number }[]>().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(true),
    active: boolean("active").notNull().default(true),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mfg_boms_item_idx").on(t.orgId, t.itemId)],
);

export const mfgWorkOrders = pgTable(
  "mfg_work_orders",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    itemId: uuid("item_id").notNull().references(() => invItems.id, { onDelete: "restrict" }),
    bomId: uuid("bom_id"),
    qty: qty("qty").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    plannedStart: date("planned_start"),
    plannedEnd: date("planned_end"),
    /** draft | released | in_progress | done | cancelled */
    status: text("status").notNull().default("draft"),
    materials: jsonb("materials").$type<{ itemId: string; required: number; issued: number }[]>().notNull().default([]),
    operations: jsonb("operations").$type<{ id: string; workCentreId: string; name: string; plannedMinutes: number; actualMinutes: number; done: boolean }[]>().notNull().default([]),
    produced: qty("produced").notNull().default(0),
    scrap: qty("scrap").notNull().default(0),
    /** Actual cost of materials issued (less returned) and of conversion, paise. */
    materialCost: bigint("material_cost", { mode: "number" }).notNull().default(0),
    conversionCost: bigint("conversion_cost", { mode: "number" }).notNull().default(0),
    unitCost: integer("unit_cost").notNull().default(0),
    salesOrderId: uuid("sales_order_id"),
    notes: text("notes").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("mfg_work_orders_org_idx").on(t.orgId, t.status)],
);

// ── Quality: inspection plans, inspections, non-conformances ──

export const qcSettings = pgTable("qc_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

export const qcPlans = pgTable(
  "qc_plans",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    itemId: uuid("item_id").references(() => invItems.id, { onDelete: "cascade" }),
    category: text("category").notNull().default(""),
    /** receipt | production | dispatch */
    stage: text("stage").notNull(),
    sampleSize: integer("sample_size").notNull().default(5),
    samplePct: real("sample_pct").notNull().default(0),
    acceptMax: integer("accept_max").notNull().default(0),
    parameters: jsonb("parameters").$type<{ id: string; name: string; kind: "measure" | "check"; min: number | null; max: number | null; unit: string }[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("qc_plans_org_idx").on(t.orgId, t.stage)],
);

export const qcInspections = pgTable(
  "qc_inspections",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    planId: uuid("plan_id").notNull(),
    stage: text("stage").notNull(),
    itemId: uuid("item_id").notNull(),
    warehouseId: uuid("warehouse_id"),
    batch: text("batch").notNull().default(""),
    /** The lot it covers, and the bin it was in (for quarantine). */
    lotQty: qty("lot_qty").notNull().default(0),
    binId: uuid("bin_id"),
    sampleCount: integer("sample_count").notNull().default(1),
    /** Where it came from: { type: receipt | work_order | sales_delivery | manual, id, no } */
    source: jsonb("source").$type<{ type: string; id: string | null; no: string }>().notNull(),
    supplierId: uuid("supplier_id"),
    /** pending | passed | failed */
    status: text("status").notNull().default("pending"),
    samples: jsonb("samples").$type<Record<string, number | boolean | null>[]>().notNull().default([]),
    defective: integer("defective").notNull().default(0),
    quarantined: qty("quarantined").notNull().default(0),
    ncrId: uuid("ncr_id"),
    notes: text("notes").notNull().default(""),
    inspectedBy: uuid("inspected_by").references(() => users.id, { onDelete: "set null" }),
    inspectedAt: timestamp("inspected_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("qc_inspections_org_idx").on(t.orgId, t.status)],
);

export const qcNcrs = pgTable(
  "qc_ncrs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    source: text("source").notNull().default("internal"),
    inspectionId: uuid("inspection_id"),
    itemId: uuid("item_id"),
    supplierId: uuid("supplier_id"),
    warehouseId: uuid("warehouse_id"),
    batch: text("batch").notNull().default(""),
    qty: qty("qty").notNull().default(0),
    severity: text("severity").notNull().default("minor"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    rootCause: text("root_cause").notNull().default(""),
    /** pending | use | rework | scrap | return */
    disposition: text("disposition").notNull().default("pending"),
    actions: jsonb("actions").$type<{ id: string; action: string; kind: "corrective" | "preventive"; ownerId: string | null; due: string | null; done: boolean }[]>().notNull().default([]),
    /** open | closed */
    status: text("status").notNull().default("open"),
    /** The quarantined quantity this report still holds, and what was done with it. */
    held: qty("held").notNull().default(0),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("qc_ncrs_org_idx").on(t.orgId, t.status)],
);

// ── HR+: shifts and rosters, overtime, settlements, documents, training, cases, positions ──

export const hrShifts = pgTable("hr_shifts", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  breakMinutes: integer("break_minutes").notNull().default(0),
  graceMin: integer("grace_min").notNull().default(15),
  color: text("color").notNull().default("#2a78d6"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [index("hr_shifts_org_idx").on(t.orgId)]);

/** Who works which shift on which day; a row with no shift is a day off. */
export const hrRoster = pgTable("hr_roster", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  shiftId: uuid("shift_id").references(() => hrShifts.id, { onDelete: "cascade" }),
}, (t) => [uniqueIndex("hr_roster_uq").on(t.employeeId, t.date), index("hr_roster_org_idx").on(t.orgId, t.date)]);

export const hrOvertime = pgTable("hr_overtime", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  minutes: integer("minutes").notNull(),
  /** auto (from check-out) | manual */
  source: text("source").notNull().default("auto"),
  /** pending | approved | rejected */
  status: text("status").notNull().default("pending"),
  note: text("note").notNull().default(""),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  payrollRunId: uuid("payroll_run_id"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_overtime_uq").on(t.employeeId, t.date), index("hr_overtime_org_idx").on(t.orgId, t.status)]);

/** Full and final settlement when someone leaves. */
export const hrSettlements = pgTable("hr_settlements", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  lastDay: date("last_day").notNull(),
  /** [{ code, label, kind: earning | recovery, amount, note }] */
  lines: jsonb("lines").$type<{ code: string; label: string; kind: "earning" | "recovery"; amount: number; note: string }[]>().notNull().default([]),
  earnings: bigint("earnings", { mode: "number" }).notNull().default(0),
  recoveries: bigint("recoveries", { mode: "number" }).notNull().default(0),
  net: bigint("net", { mode: "number" }).notNull().default(0),
  /** draft | pending_approval | approved | paid */
  status: text("status").notNull().default("draft"),
  accountId: uuid("account_id"),
  paidOn: date("paid_on"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("hr_settlements_emp_uq").on(t.employeeId)]);

export const hrDocuments = pgTable("hr_documents", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  /** contract | offer | id_proof | certificate | policy | visa | other */
  kind: text("kind").notNull().default("other"),
  title: text("title").notNull(),
  number: text("number").notNull().default(""),
  issuedOn: date("issued_on"),
  validTo: date("valid_to"),
  /** Where the file is kept (a link), if anywhere. */
  link: text("link").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("hr_documents_emp_idx").on(t.employeeId), index("hr_documents_org_idx").on(t.orgId, t.validTo)]);

export const hrTrainings = pgTable("hr_trainings", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** course | workshop | certification | induction | safety */
  kind: text("kind").notNull().default("course"),
  provider: text("provider").notNull().default(""),
  hours: real("hours").notNull().default(0),
  costPerPerson: bigint("cost_per_person", { mode: "number" }).notNull().default(0),
  /** Months a completion stays valid (0: forever) — refreshers. */
  validMonths: integer("valid_months").notNull().default(0),
  /** Everyone in these departments must have it ([] with mandatory: everyone). */
  mandatory: boolean("mandatory").notNull().default(false),
  departmentIds: jsonb("department_ids").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const hrTrainingRecords = pgTable("hr_training_records", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  trainingId: uuid("training_id").notNull().references(() => hrTrainings.id, { onDelete: "cascade" }),
  employeeId: uuid("employee_id").notNull().references(() => hrEmployees.id, { onDelete: "cascade" }),
  /** assigned | completed */
  status: text("status").notNull().default("assigned"),
  due: date("due"),
  completedOn: date("completed_on"),
  score: real("score"),
  createdAt: createdAt(),
}, (t) => [index("hr_training_records_idx").on(t.orgId, t.employeeId)]);

/** Grievances raised by employees, and disciplinary cases about them. */
export const hrCases = pgTable("hr_cases", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  /** grievance | disciplinary */
  kind: text("kind").notNull(),
  /** Who raised it (grievance) or who it's about (disciplinary). */
  employeeId: uuid("employee_id").references(() => hrEmployees.id, { onDelete: "set null" }),
  /** A grievance raised without a name shown to anyone but HR admins. */
  anonymous: boolean("anonymous").notNull().default(false),
  category: text("category").notNull().default(""),
  subject: text("subject").notNull(),
  description: text("description").notNull().default(""),
  /** open | investigating | resolved | closed */
  status: text("status").notNull().default("open"),
  assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
  /** Disciplinary: none | verbal_warning | written_warning | final_warning | suspension | termination */
  action: text("action").notNull().default("none"),
  outcome: text("outcome").notNull().default(""),
  /** [{ at, by, note }] */
  timeline: jsonb("timeline").$type<{ at: string; by: string; note: string }[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [index("hr_cases_org_idx").on(t.orgId, t.status)]);

/** The headcount plan: roles a department should have, with their budget. */
export const hrPositions = pgTable("hr_positions", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  departmentId: uuid("department_id").references(() => hrDepartments.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  planned: integer("planned").notNull().default(1),
  /** Yearly CTC budget per person, paise. */
  budgetCtc: bigint("budget_ctc", { mode: "number" }).notNull().default(0),
  byDate: date("by_date"),
  jobId: uuid("job_id"),
  notes: text("notes").notNull().default(""),
  createdAt: createdAt(),
});

// ─── Custom fields, objects, rules & bulk changes (ERP phase X) ─────────────

/** A field a workspace adds to a built-in record ("inventory.item") or to one of its own objects ("obj:<id>"). */
export const customFields = pgTable("custom_fields", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  /** text | longtext | number | money | date | select | multiselect | checkbox | url | email | phone | link */
  type: text("type").notNull(),
  options: text("options").array().notNull().default(sql`'{}'::text[]`),
  required: boolean("required").notNull().default(false),
  help: text("help").notNull().default(""),
  linkTo: text("link_to"),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("custom_fields_key_uq").on(t.orgId, t.entity, t.key)]);

/** The custom field values of one built-in record. */
export const customValues = pgTable("custom_values", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  recordId: uuid("record_id").notNull(),
  values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.orgId, t.entity, t.recordId] })]);

/** An object a workspace makes for itself (site visits, warranties, licences…). */
export const customObjects = pgTable("custom_objects", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  plural: text("plural").notNull(),
  description: text("description").notNull().default(""),
  prefix: text("prefix").notNull().default("REC"),
  titleField: text("title_field"),
  editRoles: text("edit_roles").array().notNull().default(sql`'{}'::text[]`),
  seq: integer("seq").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("custom_objects_name_uq").on(t.orgId, sql`lower(${t.plural})`)]);

export const customRecords = pgTable("custom_records", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  objectId: uuid("object_id").notNull().references(() => customObjects.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  title: text("title").notNull().default(""),
  values: jsonb("values").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("custom_records_seq_uq").on(t.objectId, t.seq), index("custom_records_org_idx").on(t.orgId, t.objectId, t.updatedAt)]);

/** "When … then … must be true" checks on saving a record's custom values. */
export const customRules = pgTable("custom_rules", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  name: text("name").notNull(),
  when: jsonb("when").$type<{ field: string; op: string; value: unknown }[]>().notNull().default([]),
  then: jsonb("then").$type<{ field: string; op: string; value: unknown }[]>().notNull().default([]),
  message: text("message").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("custom_rules_entity_idx").on(t.orgId, t.entity)]);

/** A bulk change, with what each record was before so it can be undone. */
export const bulkRuns = pgTable("bulk_runs", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  /** set | delete */
  action: text("action").notNull(),
  field: text("field"),
  value: jsonb("value"),
  changed: integer("changed").notNull().default(0),
  /** [{ id, reason }] — records left alone. */
  skipped: jsonb("skipped").$type<{ id: string; reason: string }[]>().notNull().default([]),
  /** set: [{ id, before }]; delete: [{ id, row }] */
  undo: jsonb("undo").$type<Record<string, unknown>[]>().notNull().default([]),
  /** done | undone */
  status: text("status").notNull().default("done"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
  undoneAt: timestamp("undone_at", { withTimezone: true }),
}, (t) => [index("bulk_runs_org_idx").on(t.orgId, t.createdAt)]);

/** Responses to writes sent with an Idempotency-Key (the offline outbox replays them safely). */
export const idempotentWrites = pgTable("idempotent_writes", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status").notNull(),
  body: jsonb("body"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] }), index("idempotent_writes_age_idx").on(t.createdAt)]);

/** Each person's Home dashboard in a workspace: section order, hidden sections, and which quick actions they use. */
export const userDashboards = pgTable("user_dashboards", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** { order: string[], hidden: string[] } */
  layout: jsonb("layout").$type<{ order: string[]; hidden: string[] }>().notNull().default({ order: [], hidden: [] }),
  /** Quick action id → times used from Home. */
  usage: jsonb("usage").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.orgId] })]);

/** Where a web app is also published outside the platform: a GitHub repo, a Netlify site or a Vercel project. */
export const siteTargets = pgTable("site_targets", {
  id: id(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  /** github | netlify | vercel | cloudflare */
  provider: text("provider").notNull(),
  name: text("name").notNull(),
  /** github: { repo, branch, dir }; netlify: { siteId, siteName }; vercel: { project, teamId }; cloudflare: { accountId, project } */
  config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
  /** The access token, encrypted. */
  token: text("token").notNull(),
  /** Where the site lives there (its forms may post back from this origin). */
  url: text("url").notNull().default(""),
  /** idle | running | done | failed */
  status: text("status").notNull().default("idle"),
  lastError: text("last_error").notNull().default(""),
  lastDeploymentId: uuid("last_deployment_id"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("site_targets_project_idx").on(t.projectId)]);

// ─── Mail: connected mailboxes, threads and messages ─────────────────────────

/** A connected mailbox (IMAP/SMTP with a password, or Google/Microsoft sign-in). Secrets are AES-GCM encrypted. */
export const mailAccounts = pgTable("mail_accounts", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** A team inbox (support@, sales@): members listed in mail_account_members can work it. */
  shared: boolean("shared").notNull().default(false),
  name: text("name").notNull(),
  address: text("address").notNull(),
  displayName: text("display_name").notNull().default(""),
  /** gmail | google_workspace | microsoft | zoho | yahoo | icloud | titan | hostinger | godaddy | custom */
  provider: text("provider").notNull(),
  /** password | oauth_google | oauth_microsoft */
  auth: text("auth").notNull().default("password"),
  imapHost: text("imap_host").notNull(),
  imapPort: integer("imap_port").notNull(),
  imapSecure: boolean("imap_secure").notNull().default(true),
  smtpHost: text("smtp_host").notNull(),
  smtpPort: integer("smtp_port").notNull(),
  smtpSecure: boolean("smtp_secure").notNull().default(true),
  username: text("username").notNull(),
  /** The password, or the OAuth refresh token. */
  secretEnc: text("secret_enc").notNull(),
  accessTokenEnc: text("access_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  color: text("color").notNull().default("#6366f1"),
  signature: text("signature").notNull().default(""),
  /** connecting | active | error | paused */
  status: text("status").notNull().default("connecting"),
  lastError: text("last_error").notNull().default(""),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  /** Per folder: { INBOX: { uidValidity, lastUid, path }, Sent: {…} }. */
  syncState: jsonb("sync_state").$type<Record<string, { path: string; uidValidity: number; lastUid: number }>>().notNull().default({}),
  /** { syncDays, sendDelaySec, aiTriage, savesSent } */
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("mail_accounts_org_idx").on(t.orgId), uniqueIndex("mail_accounts_org_address_uq").on(t.orgId, sql`lower(${t.address})`)]);

export const mailAccountMembers = pgTable("mail_account_members", {
  accountId: uuid("account_id").notNull().references(() => mailAccounts.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.accountId, t.userId] })]);

export const mailThreads = pgTable("mail_threads", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => mailAccounts.id, { onDelete: "cascade" }),
  subject: text("subject").notNull().default(""),
  normSubject: text("norm_subject").notNull().default(""),
  participants: jsonb("participants").$type<{ name: string; address: string }[]>().notNull().default([]),
  snippet: text("snippet").notNull().default(""),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
  messageCount: integer("message_count").notNull().default(0),
  unread: integer("unread").notNull().default(0),
  /** in | out: who wrote last. */
  lastDirection: text("last_direction").notNull().default("in"),
  category: text("category").notNull().default("primary"),
  priority: text("priority").notNull().default("normal"),
  /** inbox | archived | trash | spam */
  status: text("status").notNull().default("inbox"),
  snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
  starred: boolean("starred").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
  assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
  /** Remind me if nobody has replied by then. */
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  /** Muted: new replies stay out of the inbox. */
  muted: boolean("muted").notNull().default(false),
  /** When the oldest unanswered message from them arrived; null once we've replied (auto-replies don't count). */
  awaitingSince: timestamp("awaiting_since", { withTimezone: true }),
  /** A meeting found in this conversation (invite or link + time): when it starts, and its calendar event once added. */
  meetingAt: timestamp("meeting_at", { withTimezone: true }),
  meetingEventId: uuid("meeting_event_id"),
  warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
  reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
  aiSummary: text("ai_summary"),
  contactId: uuid("contact_id"),
  dealId: uuid("deal_id"),
  ticketId: uuid("ticket_id"),
  createdAt: createdAt(),
}, (t) => [index("mail_threads_list_idx").on(t.accountId, t.status, t.lastMessageAt), index("mail_threads_org_idx").on(t.orgId, t.lastMessageAt), index("mail_threads_subject_idx").on(t.accountId, t.normSubject)]);

export const mailMessages = pgTable("mail_messages", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => mailAccounts.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => mailThreads.id, { onDelete: "cascade" }),
  /** INBOX | Sent | … (our name; the server's path is in the account's sync state). Null for mail not yet sent. */
  folder: text("folder"),
  uid: integer("uid"),
  messageId: text("message_id").notNull().default(""),
  inReplyTo: text("in_reply_to").notNull().default(""),
  references: text("references").notNull().default(""),
  fromAddress: text("from_address").notNull().default(""),
  fromName: text("from_name").notNull().default(""),
  to: jsonb("to").$type<{ name: string; address: string }[]>().notNull().default([]),
  cc: jsonb("cc").$type<{ name: string; address: string }[]>().notNull().default([]),
  bcc: jsonb("bcc").$type<{ name: string; address: string }[]>().notNull().default([]),
  replyTo: text("reply_to").notNull().default(""),
  subject: text("subject").notNull().default(""),
  date: timestamp("date", { withTimezone: true }).notNull().defaultNow(),
  snippet: text("snippet").notNull().default(""),
  text: text("text").notNull().default(""),
  html: text("html"),
  seen: boolean("seen").notNull().default(false),
  /** in | out */
  direction: text("direction").notNull().default("in"),
  listUnsubscribe: text("list_unsubscribe").notNull().default(""),
  listUnsubscribePost: boolean("list_unsubscribe_post").notNull().default(false),
  authResults: text("auth_results").notNull().default(""),
  hasAttachments: boolean("has_attachments").notNull().default(false),
  sizeBytes: integer("size_bytes").notNull().default(0),
  /** Outgoing: draft | scheduled | sending | sent | failed | cancelled. Null for received mail. */
  sendStatus: text("send_status"),
  sendAt: timestamp("send_at", { withTimezone: true }),
  sendError: text("send_error").notNull().default(""),
  sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
  /** An automatic reply (out of office): sent with Auto-Submitted, and never counted as answering. */
  auto: boolean("auto").notNull().default(false),
  /** A meeting found in this message: from its calendar invite, or a video link (and a time read from the text). */
  meeting: jsonb("meeting").$type<Record<string, unknown>>(),
  /** Sent to address-book groups: which ones, and the addresses typed in by hand. The groups become their members when it goes. */
  groupSend: jsonb("group_send").$type<{ groups: { id: string; name: string; color: string }[]; explicit: string[] }>(),
  createdAt: createdAt(),
}, (t) => [index("mail_messages_thread_idx").on(t.threadId, t.date), uniqueIndex("mail_messages_uid_uq").on(t.accountId, t.folder, t.uid), index("mail_messages_msgid_idx").on(t.accountId, t.messageId), index("mail_messages_send_idx").on(t.sendStatus, t.sendAt), index("mail_messages_account_date_idx").on(t.accountId, t.date)]);

export const mailAttachments = pgTable("mail_attachments", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => mailMessages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  contentId: text("content_id").notNull().default(""),
  inline: boolean("inline").notNull().default(false),
  /** Kept up to 15 MB per file; larger ones are listed but not stored. */
  data: bytea("data"),
}, (t) => [index("mail_attachments_message_idx").on(t.messageId)]);

export const mailRules = pgTable("mail_rules", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => mailAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  match: text("match").notNull().default("all"),
  conditions: jsonb("conditions").$type<{ field: string; op: string; value: string }[]>().notNull(),
  actions: jsonb("actions").$type<{ type: string; value: string }[]>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  hits: integer("hits").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("mail_rules_org_idx").on(t.orgId)]);

export const mailTemplates = pgTable("mail_templates", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  shared: boolean("shared").notNull().default(false),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  shortcut: text("shortcut").notNull().default(""),
  uses: integer("uses").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [index("mail_templates_org_idx").on(t.orgId)]);

/** Internal notes on a team-inbox conversation — never sent to the customer. */
export const mailNotes = pgTable("mail_notes", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => mailThreads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (t) => [index("mail_notes_thread_idx").on(t.threadId)]);

/** A person's email signatures: their details and a design (rendered to HTML when sending). */
export const mailSignatures = pgTable("mail_signatures", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  design: text("design").notNull(),
  fields: jsonb("fields").$type<Record<string, string>>().notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mail_signatures_owner_idx").on(t.orgId, t.ownerId)]);

/** Which signature someone uses by default in each mailbox: one for new mail, one for replies and forwards (null = none). */
export const mailSignatureDefaults = pgTable("mail_signature_defaults", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => mailAccounts.id, { onDelete: "cascade" }),
  newId: uuid("new_id").references(() => mailSignatures.id, { onDelete: "set null" }),
  replyId: uuid("reply_id").references(() => mailSignatures.id, { onDelete: "set null" }),
}, (t) => [primaryKey({ columns: [t.userId, t.accountId] })]);

/** Logos and photos for signatures, served publicly at /mail-img/<id> so recipients' mail apps can load them. */
export const mailSignatureImages = pgTable("mail_signature_images", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
}, (t) => [index("mail_signature_images_owner_idx").on(t.ownerId)]);

/** Who has had an automatic reply lately, so each sender gets at most one every few days. */
export const mailAutoReplies = pgTable("mail_auto_replies", {
  accountId: uuid("account_id").notNull().references(() => mailAccounts.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.accountId, t.address] })]);

/** Senders a person has blocked or approved (the screener), and VIPs. */
export const mailSenders = pgTable("mail_senders", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => mailAccounts.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  /** allowed | blocked | vip */
  verdict: text("verdict").notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.accountId, t.address] })]);

// ── Calendar ────────────────────────────────────────────────────────────────

/** A person's calendars (Work, Personal…), each with a colour. */
export const calCalendars = pgTable("cal_calendars", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#2563eb"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("cal_calendars_owner_idx").on(t.orgId, t.ownerId)]);

/** Events: made here, or added from an email (invite or meeting link). Times in UTC; repeats in the event's zone. */
export const calEvents = pgTable("cal_events", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  calendarId: uuid("calendar_id").notNull().references(() => calCalendars.id, { onDelete: "cascade" }),
  /** The iCalendar UID (from an invite, or ours when we send one) and its version. */
  uid: text("uid").notNull(),
  sequence: integer("sequence").notNull().default(0),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  location: text("location").notNull().default(""),
  meetingUrl: text("meeting_url").notNull().default(""),
  meetingProvider: text("meeting_provider"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  allDay: boolean("all_day").notNull().default(false),
  tz: text("tz").notNull().default("Asia/Kolkata"),
  repeat: jsonb("repeat").$type<Record<string, unknown> | null>(),
  /** Occurrences removed from a repeating event (their start, UTC ms). */
  skip: jsonb("skip").$type<number[]>().notNull().default([]),
  organizer: jsonb("organizer").$type<{ name: string; email: string } | null>(),
  attendees: jsonb("attendees").$type<{ name: string; email: string; response?: string }[]>().notNull().default([]),
  /** Minutes before the start for dashboard reminders. */
  reminders: jsonb("reminders").$type<number[]>().notNull().default([]),
  color: text("color"),
  /** confirmed | tentative | cancelled */
  status: text("status").notNull().default("confirmed"),
  /** Your answer to an invite: accepted | tentative | declined. */
  response: text("response"),
  /** manual | mail */
  source: text("source").notNull().default("manual"),
  mailAccountId: uuid("mail_account_id").references(() => mailAccounts.id, { onDelete: "set null" }),
  mailThreadId: uuid("mail_thread_id").references(() => mailThreads.id, { onDelete: "set null" }),
  mailMessageId: uuid("mail_message_id").references(() => mailMessages.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("cal_events_owner_time_idx").on(t.orgId, t.ownerId, t.startsAt), index("cal_events_uid_idx").on(t.ownerId, t.uid)]);

/** Reminders already sent (per occurrence and offset; offset -1 = "add the minutes" asked), so none repeats. */
export const calRemindersSent = pgTable("cal_reminders_sent", {
  eventId: uuid("event_id").notNull().references(() => calEvents.id, { onDelete: "cascade" }),
  occurrence: timestamp("occurrence", { withTimezone: true }).notNull(),
  offset: integer("offset").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventId, t.occurrence, t.offset] })]);

/** Minutes of meeting (MOM) for one occurrence of an event, and whom they were shared with. */
export const calNotes = pgTable("cal_notes", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => calEvents.id, { onDelete: "cascade" }),
  occurrence: timestamp("occurrence", { withTimezone: true }).notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
  sharedAt: timestamp("shared_at", { withTimezone: true }),
  sharedTo: jsonb("shared_to").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("cal_notes_occurrence_uq").on(t.eventId, t.occurrence)]);

// ── Mail address book ───────────────────────────────────────────────────────

/** The workspace's address book: people you email, shared by the team. */
export const mailContacts = pgTable("mail_contacts", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull().default(""),
  email: text("email").notNull(),
  company: text("company").notNull().default(""),
  title: text("title").notNull().default(""),
  phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  favorite: boolean("favorite").notNull().default(false),
  lastEmailedAt: timestamp("last_emailed_at", { withTimezone: true }),
  emailCount: integer("email_count").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("mail_contacts_org_email_uq").on(t.orgId, sql`lower(${t.email})`), index("mail_contacts_org_name_idx").on(t.orgId, t.name)]);

/** Groups of contacts (Suppliers, Board, Distributors…) to email together. */
export const mailContactGroups = pgTable("mail_contact_groups", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#2563eb"),
  description: text("description").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("mail_contact_groups_org_name_uq").on(t.orgId, sql`lower(${t.name})`)]);

export const mailContactGroupMembers = pgTable("mail_contact_group_members", {
  groupId: uuid("group_id").notNull().references(() => mailContactGroups.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").notNull().references(() => mailContacts.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.groupId, t.contactId] }), index("mail_contact_group_members_contact_idx").on(t.contactId)]);

/**
 * What an email conversation was turned into elsewhere: a note, a calendar
 * event, a chat message, a task. The email lists them ("Connected"), and each
 * of them links back to the email. A row is dropped when what it points to is gone.
 */
export const mailLinks = pgTable("mail_links", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => mailThreads.id, { onDelete: "cascade" }),
  /** The message it came from, when it was one message. */
  messageId: uuid("message_id").references(() => mailMessages.id, { onDelete: "set null" }),
  /** note | event | chat | task */
  kind: text("kind").notNull(),
  targetId: uuid("target_id").notNull(),
  label: text("label").notNull().default(""),
  href: text("href").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("mail_links_uq").on(t.threadId, t.kind, t.targetId), index("mail_links_target_idx").on(t.kind, t.targetId)]);

// ── Recurring emails (Mail) ───────────────────────────────────────────────
// The same email sent on a schedule. The rules live in src/lib/mail/schedule.ts;
// each send is a normal outgoing message, recorded in mail_schedule_runs.

export const mailSchedules = pgTable("mail_schedules", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => mailAccounts.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default(""),
  /** active | paused | ended */
  status: text("status").notNull().default("active"),
  /** Why it paused or ended ("All 20 sent", "Asha replied", "The mailbox was removed"…). */
  statusNote: text("status_note").notNull().default(""),
  to: jsonb("to").$type<string[]>().notNull().default([]),
  cc: jsonb("cc").$type<string[]>().notNull().default([]),
  bcc: jsonb("bcc").$type<string[]>().notNull().default([]),
  groupIds: jsonb("group_ids").$type<string[]>().notNull().default([]),
  separately: boolean("separately").notNull().default(false),
  subject: text("subject").notNull(),
  body: text("body").notNull().default(""),
  /** Signature: a signature id, "none", or "" for the mailbox's default. */
  signature: text("signature").notNull().default(""),
  startDate: text("start_date").notNull(),
  times: jsonb("times").$type<string[]>().notNull(),
  tz: text("tz").notNull().default("Asia/Kolkata"),
  repeat: jsonb("repeat").$type<{ freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number; byDay: number[]; until: string | null; count: number | null }>().notNull(),
  skipDates: jsonb("skip_dates").$type<string[]>().notNull().default([]),
  limit: integer("limit"),
  /** { thread: "new" | "same", stopOnReply, missed: "send" | "skip", notifyEach } */
  options: jsonb("options").$type<{ thread: "new" | "same"; stopOnReply: boolean; missed: "send" | "skip"; notifyEach: boolean }>().notNull(),
  /** The meeting each email is about, or null. */
  meeting: jsonb("meeting").$type<{ title: string; at: string | null; durationMin: number; link: string; makeLink: boolean; addToCalendar: boolean; calendarId: string | null; invite: boolean; details: boolean; reminders: number[] } | null>(),
  /** The repeating calendar event kept in step with the schedule. */
  eventId: uuid("event_id").references(() => calEvents.id, { onDelete: "set null" }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  sentCount: integer("sent_count").notNull().default(0),
  /** Failures in a row (three pause it). */
  failStreak: integer("fail_streak").notNull().default(0),
  /** With thread "same": the conversation and the last message sent into it. */
  threadId: uuid("thread_id"),
  lastMessageId: uuid("last_message_id"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mail_schedules_org_idx").on(t.orgId, t.createdBy), index("mail_schedules_due_idx").on(t.nextRunAt).where(sql`status = 'active'`)]);

export const mailScheduleFiles = pgTable("mail_schedule_files", {
  id: id(),
  scheduleId: uuid("schedule_id").notNull().references(() => mailSchedules.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  createdAt: createdAt(),
}, (t) => [index("mail_schedule_files_schedule_idx").on(t.scheduleId)]);

/** Each planned send: sent (with its message), skipped or failed — once per moment (the unique index). */
export const mailScheduleRuns = pgTable("mail_schedule_runs", {
  id: id(),
  scheduleId: uuid("schedule_id").notNull().references(() => mailSchedules.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  plannedFor: timestamp("planned_for", { withTimezone: true }).notNull(),
  /** sent | skipped | failed */
  status: text("status").notNull(),
  note: text("note").notNull().default(""),
  /** Which email this was (1, 2, 3…) when sent. */
  n: integer("n"),
  manual: boolean("manual").notNull().default(false),
  messageId: uuid("message_id"),
  threadId: uuid("thread_id"),
  recipients: integer("recipients").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("mail_schedule_runs_uq").on(t.scheduleId, t.plannedFor), index("mail_schedule_runs_schedule_idx").on(t.scheduleId, t.createdAt)]);

// ── Team chat (module "chat") ─────────────────────────────────────────────
// Channels (public or private), group chats and direct messages for the
// people in a workspace. Not the website chatbot (chat_* tables above).

export const teamChannels = pgTable("team_channels", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** channel | group | dm */
  kind: text("kind").notNull(),
  name: text("name").notNull().default(""),
  topic: text("topic").notNull().default(""),
  description: text("description").notNull().default(""),
  /** public (anyone in the workspace may join) | private (invite only). Groups and DMs are private. */
  visibility: text("visibility").notNull().default("public"),
  emoji: text("emoji").notNull().default(""),
  color: text("color").notNull().default("#2563eb"),
  /** A picture for a group or channel (an image in team_files), set by its admins. */
  avatarFileId: uuid("avatar_file_id"),
  /** DMs: the two user ids, sorted and joined — one DM per pair. */
  dmKey: text("dm_key"),
  /** { posting: "everyone" | "admins", ai: boolean } */
  settings: jsonb("settings").$type<{ posting?: "everyone" | "admins"; ai?: boolean }>().notNull().default({}),
  archived: boolean("archived").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("team_channels_org_idx").on(t.orgId, t.kind), uniqueIndex("team_channels_dm_uq").on(t.orgId, t.dmKey), uniqueIndex("team_channels_name_uq").on(t.orgId, sql`lower(${t.name})`).where(sql`kind = 'channel'`)]);

export const teamMembers = pgTable("team_members", {
  channelId: uuid("channel_id").notNull().references(() => teamChannels.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** owner | admin | member */
  role: text("role").notNull().default("member"),
  /** The last message seq read (seq is global and increasing). */
  readSeq: bigint("read_seq", { mode: "number" }).notNull().default(0),
  /** all | mentions | none */
  notify: text("notify").notNull().default("all"),
  starred: boolean("starred").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  joinedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.channelId, t.userId] }), index("team_members_user_idx").on(t.orgId, t.userId)]);

export const teamMessages = pgTable("team_messages", {
  id: id(),
  /** Order of everything: messages, edits and thread replies. */
  seq: bigserial("seq", { mode: "number" }).notNull(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").notNull().references(() => teamChannels.id, { onDelete: "cascade" }),
  /** A reply in a thread: the message it replies to. */
  parentId: uuid("parent_id").references((): AnyPgColumn => teamMessages.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  /** text | system | poll | record | checklist | decision | approval | call | ai | event */
  kind: text("kind").notNull().default("text"),
  body: text("body").notNull().default(""),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  /** { users: string[], everyone: boolean, records: { kind, id, label, link }[] } */
  mentions: jsonb("mentions").$type<{ users: string[]; everyone: boolean; records: { kind: string; id: string; label: string; link: string }[] }>().notNull().default({ users: [], everyone: false, records: [] }),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  /** normal | important | urgent */
  priority: text("priority").notNull().default("normal"),
  replyCount: integer("reply_count").notNull().default(0),
  lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
  forwardedFrom: uuid("forwarded_from"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  pinnedAt: timestamp("pinned_at", { withTimezone: true }),
  pinnedBy: uuid("pinned_by"),
  /** Scheduled: it posts at this time (until then only its author sees it). */
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("team_messages_channel_idx").on(t.channelId, t.seq), index("team_messages_parent_idx").on(t.parentId, t.seq), index("team_messages_org_seq_idx").on(t.orgId, t.seq), index("team_messages_sched_idx").on(t.scheduledFor).where(sql`scheduled_for is not null`), index("team_messages_body_trgm_idx").using("gin", sql`${t.body} gin_trgm_ops`)]);

export const teamReactions = pgTable("team_reactions", {
  messageId: uuid("message_id").notNull().references(() => teamMessages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })]);

/** Answers to polls, ticks on checklists, votes on decisions and approvals: one row per person and choice. */
export const teamVotes = pgTable("team_votes", {
  messageId: uuid("message_id").notNull().references(() => teamMessages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  choice: text("choice").notNull(),
  note: text("note").notNull().default(""),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.messageId, t.userId, t.choice] })]);

export const teamFiles = pgTable("team_files", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").notNull().references(() => teamChannels.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => teamMessages.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("team_files_channel_idx").on(t.channelId, t.createdAt), index("team_files_message_idx").on(t.messageId)]);

/** Saved for later, optionally with a reminder. */
export const teamSaved = pgTable("team_saved", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => teamMessages.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  remindAt: timestamp("remind_at", { withTimezone: true }),
  reminded: boolean("reminded").notNull().default(false),
  done: boolean("done").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.messageId] }), index("team_saved_remind_idx").on(t.remindAt).where(sql`remind_at is not null and not reminded`)]);

/** Your status: available | busy | dnd | away, a note, until when; lastSeenAt drives "online". */
export const teamPresence = pgTable("team_presence", {
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("available"),
  note: text("note").notNull().default(""),
  emoji: text("emoji").notNull().default(""),
  until: timestamp("until", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.orgId, t.userId] })]);

/**
 * A link that lets people outside the workspace ask to join one conversation
 * as a guest — no Cloudesk account, just a name. Revoking it stops new
 * requests; guests already in stay until they're removed.
 */
export const teamInvites = pgTable("team_invites", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").notNull().references(() => teamChannels.id, { onDelete: "cascade" }),
  /** The secret in the link (/j/<code>). */
  code: text("code").notNull(),
  /** What the inviter calls it ("Suppliers", "Wedding guests"). */
  label: text("label").notNull().default(""),
  /** An admin lets each person in (true), or anyone with the link joins straight away (false). */
  approval: boolean("approval").notNull().default(true),
  /** Guests see the messages from before they joined. */
  history: boolean("history").notNull().default(false),
  /** Guests may share files. */
  files: boolean("files").notNull().default(true),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  /** Where it was sent from Cloudesk: [{ via: "email", to, at }]. */
  sent: jsonb("sent").$type<{ via: string; to: string; at: string }[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("team_invites_code_uq").on(t.code), index("team_invites_channel_idx").on(t.channelId)]);

/**
 * Someone who joined (or asked to join) a conversation through an invite.
 * Each guest has a hidden identity in `users` (no password, an unroutable
 * address) so their messages, reactions and files work like anyone's; they
 * reach Chat only through their own cookie, and only this conversation.
 */
export const teamGuests = pgTable("team_guests", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").notNull().references(() => teamChannels.id, { onDelete: "cascade" }),
  inviteId: uuid("invite_id").references(() => teamInvites.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  /** An email or phone number they chose to give (optional). */
  contact: text("contact").notNull().default(""),
  /** What they said when asking to join. */
  note: text("note").notNull().default(""),
  /** pending | approved | rejected | removed | left */
  status: text("status").notNull().default("pending"),
  /** SHA-256 of the guest's secret (in their cookie). */
  tokenHash: text("token_hash").notNull(),
  /** Without history they see messages after this seq only. */
  sinceSeq: bigint("since_seq", { mode: "number" }).notNull().default(0),
  history: boolean("history").notNull().default(false),
  files: boolean("files").notNull().default(true),
  reason: text("reason").notNull().default(""),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ip: text("ip"),
  userAgent: text("user_agent").notNull().default(""),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("team_guests_token_uq").on(t.tokenHash), index("team_guests_channel_idx").on(t.channelId, t.status), index("team_guests_user_idx").on(t.userId)]);

// ── Feature requests (workspaces → the Cloudesk team) ──────────────────────

export const featureRequests = pgTable("feature_requests", {
  id: id(),
  number: bigserial("number", { mode: "number" }).notNull(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  problem: text("problem").notNull().default(""),
  details: text("details").notNull().default(""),
  /** A module id, or "new" for something Cloudesk doesn't do yet. */
  area: text("area").notNull().default("new"),
  /** nice | important | critical */
  priority: text("priority").notNull().default("important"),
  /** workspace (just for us) | everyone (useful to all) */
  scope: text("scope").notNull().default("everyone"),
  /** submitted | under_review | planned | in_progress | testing | released | declined | duplicate */
  status: text("status").notNull().default("submitted"),
  /** What the Cloudesk team says (the workspace sees it). */
  reply: text("reply").notNull().default(""),
  eta: date("eta"),
  /** Shown on the public roadmap, where other workspaces can see and vote. */
  public: boolean("public").notNull().default(false),
  duplicateOf: uuid("duplicate_of"),
  /** The release flag that delivers it, and how it was given out. */
  flagKey: text("flag_key"),
  release: jsonb("release").$type<{ mode: "everyone" | "workspaces"; orgIds: string[]; notes: string; by: string; at: string } | null>(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  votes: integer("votes").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("feature_requests_org_idx").on(t.orgId, t.createdAt), index("feature_requests_status_idx").on(t.status, t.updatedAt), uniqueIndex("feature_requests_number_uq").on(t.number)]);

export const featureRequestVotes = pgTable("feature_request_votes", {
  requestId: uuid("request_id").notNull().references(() => featureRequests.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.requestId, t.userId] })]);

/** The conversation on a request, and its history. internal = only the Cloudesk team sees it. */
export const featureRequestNotes = pgTable("feature_request_notes", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => featureRequests.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  /** comment | status | release */
  kind: text("kind").notNull().default("comment"),
  fromTeam: boolean("from_team").notNull().default(false),
  internal: boolean("internal").notNull().default(false),
  body: text("body").notNull().default(""),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("feature_request_notes_req_idx").on(t.requestId, t.createdAt)]);

// ─── Subscriptions (plans, trials, invoices) ────────────────────────────────

/** The plans on sale (Admin → Plans). modules null = every feature. Prices in minor units. */
export const planCatalog = pgTable("plan_catalog", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  /** preset | basic */
  kind: text("kind").notNull().default("preset"),
  modules: jsonb("modules").$type<string[] | null>(),
  limits: jsonb("limits").$type<{ projects: number; seats: number; customDomains: number; automationsPerProject: number }>().notNull(),
  /** Monthly allowances (invoicesPerMonth, contacts, aiPerMonth); missing = unlimited. */
  quotas: jsonb("quotas").$type<Record<string, number>>().notNull().default({}),
  monthly: integer("monthly").notNull(),
  yearly: integer("yearly").notNull(),
  currency: text("currency").notNull().default("INR"),
  highlight: boolean("highlight").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sort: integer("sort").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A workspace's subscription: what it chose (a snapshot, so later catalogue
 * edits don't change what someone already pays for), its trial and its period.
 */
export const orgSubscriptions = pgTable("org_subscriptions", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** A catalogue plan id, or "custom". */
  planId: text("plan_id").notNull(),
  planName: text("plan_name").notNull(),
  modules: jsonb("modules").$type<string[] | null>(),
  limits: jsonb("limits").$type<{ projects: number; seats: number; customDomains: number; automationsPerProject: number }>().notNull(),
  seats: integer("seats").notNull().default(0),
  quotas: jsonb("quotas").$type<Record<string, number>>().notNull().default({}),
  /** month | year */
  interval: text("interval").notNull().default("month"),
  /** One period, before tax, minor units. */
  amount: integer("amount").notNull().default(0),
  /** The same per month, for comparing and MRR. */
  monthly: integer("monthly").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  lines: jsonb("lines").$type<{ label: string; amount: number; module?: string }[]>().notNull().default([]),
  /** trialing | active | past_due | canceled | expired */
  status: text("status").notNull().default("trialing"),
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  /** A change that starts with the next period (downgrades). */
  pending: jsonb("pending").$type<Record<string, unknown> | null>(),
  /** Credit carried to the next invoice, minor units. */
  credit: integer("credit").notNull().default(0),
  /** Given by the platform at no charge (until compUntil, or for good). */
  complimentary: boolean("complimentary").notNull().default(false),
  compUntil: timestamp("comp_until", { withTimezone: true }),
  /** Set by the platform team on top of the plan: extra features, limits and allowances (Admin → a workspace). */
  overrides: jsonb("overrides").$type<{ modules?: string[]; limits?: Record<string, number>; quotas?: Record<string, number | null>; note?: string }>().notNull().default({}),
  /** Which trial reminders went out (days before the end). */
  reminded: jsonb("reminded").$type<number[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("org_subscriptions_org_uq").on(t.orgId), index("org_subscriptions_status_idx").on(t.status, t.currentPeriodEnd), index("org_subscriptions_trial_idx").on(t.trialEndsAt)]);

export const subscriptionInvoices = pgTable("subscription_invoices", {
  id: id(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** first | renewal | upgrade | topup | manual */
  kind: text("kind").notNull(),
  description: text("description").notNull().default(""),
  lines: jsonb("lines").$type<{ label: string; amount: number }[]>().notNull().default([]),
  subtotal: integer("subtotal").notNull(),
  creditApplied: integer("credit_applied").notNull().default(0),
  taxBps: integer("tax_bps").notNull().default(0),
  taxLabel: text("tax_label").notNull().default("GST"),
  tax: integer("tax").notNull().default(0),
  total: integer("total").notNull(),
  currency: text("currency").notNull().default("INR"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  /** open | paid | void */
  status: text("status").notNull().default("open"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  /** razorpay | stripe | manual | credit */
  paidVia: text("paid_via"),
  /** The provider's order / checkout session for this invoice. */
  providerRef: text("provider_ref"),
  /** The provider's payment id (or the reference recorded by an admin); one payment pays one invoice. */
  paymentRef: text("payment_ref"),
  /** What paying this invoice does: the subscription snapshot to apply. */
  applies: jsonb("applies").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("subscription_invoices_seq_uq").on(t.seq), uniqueIndex("subscription_invoices_payment_uq").on(t.paymentRef), index("subscription_invoices_org_idx").on(t.orgId, t.createdAt), index("subscription_invoices_status_idx").on(t.status, t.dueAt)]);

/** The subscription's timeline: trial started, plan changed, paid, renewed, expired… */
export const subscriptionEvents = pgTable("subscription_events", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  /** The platform did it (Admin), not the workspace. */
  byPlatform: boolean("by_platform").notNull().default(false),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [index("subscription_events_org_idx").on(t.orgId, t.createdAt)]);

/**
 * Top-ups: allowances bought once (e.g. +500 AI requests), on any plan. A
 * "purchase" row adds units; at the end of each month a "used" row records how
 * much of the balance went on usage beyond the plan's own allowance that month
 * — so unused top-ups carry over and are never charged twice.
 */
export const quotaTopups = pgTable("quota_topups", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** The allowance: aiPerMonth, aiBudgetUsd (the AI spend that comes with AI requests), invoicesPerMonth… */
  key: text("key").notNull(),
  /** purchase | used */
  kind: text("kind").notNull(),
  units: doublePrecision("units").notNull(),
  /** For "used": the month it covers, YYYY-MM (UTC). */
  month: text("month"),
  invoiceId: uuid("invoice_id").references(() => subscriptionInvoices.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("quota_topups_org_idx").on(t.orgId, t.key), uniqueIndex("quota_topups_used_uq").on(t.orgId, t.key, t.month).where(sql`kind = 'used'`)]);

/**
 * One-time codes sent by email (sign-up and sign-in). Only an HMAC of the code
 * is stored; a code works once, for 10 minutes, with 5 tries.
 */
export const emailOtps = pgTable("email_otps", {
  id: id(),
  email: text("email").notNull(),
  /** signup | login */
  purpose: text("purpose").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  /** Sign-up details waiting for the code (the password is already hashed). */
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  ip: text("ip"),
  createdAt: createdAt(),
}, (t) => [index("email_otps_email_idx").on(sql`lower(${t.email})`, t.purpose, t.createdAt)]);

// ─── Firewall ───────────────────────────────────────────────────────────────

/** Requests the firewall refused or flagged (kept 30 days). */
export const firewallEvents = pgTable("firewall_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  country: text("country"),
  method: text("method").notNull(),
  host: text("host").notNull().default(""),
  path: text("path").notNull(),
  /** The rule id, e.g. sqli-union, probe-secrets, rate-limit, ban, custom:office-only. */
  rule: text("rule").notNull(),
  /** sqli | xss | traversal | probes | scanners | protocol | injection | ip | country | custom | rate | ban | origin */
  grp: text("grp").notNull(),
  /** block | log */
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  ua: text("ua").notNull().default(""),
}, (t) => [index("firewall_events_at_idx").on(t.at), index("firewall_events_ip_idx").on(t.ip, t.at)]);

/** Addresses refused outright until a time (automatic after repeated attacks, or by an admin). */
export const firewallBans = pgTable("firewall_bans", {
  ip: text("ip").primaryKey(),
  reason: text("reason").notNull().default(""),
  /** auto | manual */
  source: text("source").notNull().default("manual"),
  until: timestamp("until", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  /** Also pushed to Cloudflare as an IP access rule (its id). */
  cloudflareRuleId: text("cloudflare_rule_id"),
  createdAt: createdAt(),
});

// ─── Calculator ─────────────────────────────────────────────────────────────

/** A person's calculator history in a workspace: typed calculations and business formulas. */
export const calcHistory = pgTable("calc_history", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** expr | formula */
  kind: text("kind").notNull(),
  /** The calculation as typed, or the formula id. */
  input: text("input").notNull(),
  /** A formula's inputs. */
  values: jsonb("values").$type<Record<string, number | string>>(),
  /** The main result as shown, and the number behind it (null for text results). */
  result: text("result").notNull(),
  resultValue: numeric("result_value"),
  /** A note the person added ("Q3 rent split"). */
  note: text("note").notNull().default(""),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: createdAt(),
}, (t) => [index("calc_history_user_idx").on(t.orgId, t.userId, t.createdAt)]);

/**
 * Partners: agencies and firms, freelancers, sales and marketing partners and
 * influencers who bring customers to Cloudesk and earn a share of what those
 * customers pay. One record per account; reviewed by a platform admin.
 */
export const partners = pgTable("partners", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** organisation | freelancer | sales | marketing | influencer */
  type: text("type").notNull(),
  /** pending | approved | rejected | suspended */
  status: text("status").notNull().default("pending"),
  /** The partner's own code, for links (/go/CODE) and as a coupon. */
  code: text("code").notNull(),
  /** Company or person, as shown to the partner and in the console. */
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  country: text("country").notNull().default("IN"),
  city: text("city").notNull().default(""),
  website: text("website").notNull().default(""),
  /** The answers from the application (differ by type). */
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  /** upi | bank | null — the details themselves are encrypted. */
  payoutMethod: text("payout_method"),
  payoutEnc: text("payout_enc"),
  /** "UPI · pri…@okhdfc", "HDFC0001234 · ••••6789" — never the full details. */
  payoutHint: text("payout_hint").notNull().default(""),
  /** Overrides of the program's rates for this partner (null = the type's rate). */
  commissionBps: integer("commission_bps"),
  commissionMonths: integer("commission_months"),
  /** Shown to the partner (why it was rejected or suspended). */
  reviewNote: text("review_note").notNull().default(""),
  /** For admins only. */
  adminNote: text("admin_note").notNull().default(""),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("partners_user_uq").on(t.userId), uniqueIndex("partners_code_uq").on(t.code), index("partners_status_idx").on(t.status, t.createdAt)]);

/** Codes customers enter (or arrive with) for a discount; whoever owns the code earns. */
export const partnerCoupons = pgTable("partner_coupons", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  /** "Instagram — Diwali", or "" for the partner's own code. */
  label: text("label").notNull().default(""),
  primary: boolean("primary").notNull().default(false),
  /** The customer's discount, on their first `discountPayments` payments. */
  discountBps: integer("discount_bps").notNull().default(0),
  discountPayments: integer("discount_payments").notNull().default(1),
  /** Overrides the partner's commission for customers who used this code. */
  commissionBps: integer("commission_bps"),
  active: boolean("active").notNull().default(true),
  maxUses: integer("max_uses"),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("partner_coupons_code_uq").on(t.code), index("partner_coupons_partner_idx").on(t.partnerId)]);

/** A workspace brought by a partner. One partner per workspace. */
export const partnerReferrals = pgTable("partner_referrals", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  couponId: uuid("coupon_id").references(() => partnerCoupons.id, { onDelete: "set null" }),
  code: text("code").notNull().default(""),
  /** link | coupon | lead | manual */
  source: text("source").notNull(),
  campaign: text("campaign").notNull().default(""),
  /** The customer's discount and how many payments it still applies to. */
  discountBps: integer("discount_bps").notNull().default(0),
  discountLeft: integer("discount_left").notNull().default(0),
  /** Commission for this customer: the coupon's rate if it had one (else the partner's at the time), until this date (null = for as long as they pay). */
  commissionBps: integer("commission_bps"),
  commissionUntil: timestamp("commission_until", { withTimezone: true }),
  /** active | reversed */
  status: text("status").notNull().default("active"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("partner_referrals_org_uq").on(t.orgId), index("partner_referrals_partner_idx").on(t.partnerId, t.createdAt)]);

/** What a partner earned: a share of a paid invoice, or an adjustment by an admin. */
export const partnerCommissions = pgTable("partner_commissions", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  referralId: uuid("referral_id").references(() => partnerReferrals.id, { onDelete: "set null" }),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => subscriptionInvoices.id, { onDelete: "set null" }),
  /** invoice | adjustment */
  kind: text("kind").notNull().default("invoice"),
  /** What the customer paid before tax, the rate and the commission (paise). */
  basis: integer("basis").notNull().default(0),
  rateBps: integer("rate_bps").notNull().default(0),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  /** earned | void */
  status: text("status").notNull().default("earned"),
  /** Withdrawable from this time (after the hold). */
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  note: text("note").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("partner_commissions_invoice_uq").on(t.invoiceId), index("partner_commissions_partner_idx").on(t.partnerId, t.createdAt)]);

/** A request to withdraw earnings; an admin approves it and records the transfer. */
export const partnerPayouts = pgTable("partner_payouts", {
  id: id(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  /** Tax withheld (TDS) and what's transferred. */
  tds: integer("tds").notNull().default(0),
  net: integer("net").notNull(),
  currency: text("currency").notNull().default("INR"),
  /** requested | approved | paid | rejected | cancelled */
  status: text("status").notNull().default("requested"),
  method: text("method").notNull().default(""),
  note: text("note").notNull().default(""),
  /** Why it was rejected, or anything the admin wants the partner to know. */
  adminNote: text("admin_note").notNull().default(""),
  /** The bank/UPI transfer reference. */
  reference: text("reference").notNull().default(""),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("partner_payouts_seq_uq").on(t.seq), index("partner_payouts_partner_idx").on(t.partnerId, t.createdAt), index("partner_payouts_status_idx").on(t.status, t.createdAt)]);

/** Deals a partner registered before the customer signed up (protected for a while). */
export const partnerLeads = pgTable("partner_leads", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  company: text("company").notNull(),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  notes: text("notes").notNull().default(""),
  /** Expected monthly value in paise (the partner's estimate). */
  value: integer("value").notNull().default(0),
  /** registered | contacted | demo | signed_up | won | lost */
  status: text("status").notNull().default("registered"),
  orgId: uuid("org_id").references(() => organizations.id, { onDelete: "set null" }),
  /** The registration protects the lead until then. */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("partner_leads_partner_idx").on(t.partnerId, t.createdAt), index("partner_leads_email_idx").on(sql`lower(${t.email})`)]);

/** Visits through partner links, counted per day and campaign. */
export const partnerClicks = pgTable("partner_clicks", {
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  campaign: text("campaign").notNull().default(""),
  day: date("day").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.partnerId, t.code, t.campaign, t.day] })]);

/**
 * Notes: each person's notes and daily notes, in nested folders, as a list of
 * blocks. Private unless shared with the workspace, with chosen members, or
 * published read-only by a link. Any note can be attached to a page or a
 * record in another module.
 */
export const noteFolders = pgTable("note_folders", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => noteFolders.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("slate"),
  icon: text("icon").notNull().default(""),
  sort: real("sort").notNull().default(0),
  /** A module's folder ("crm"), made the first time a note is saved from it. */
  module: text("module"),
  createdAt: createdAt(),
}, (t) => [index("note_folders_owner_idx").on(t.orgId, t.ownerId)]);

export const notes = pgTable("notes", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  folderId: uuid("folder_id").references(() => noteFolders.id, { onDelete: "set null" }),
  title: text("title").notNull().default(""),
  icon: text("icon").notNull().default(""),
  color: text("color").notNull().default(""),
  /** { blocks: [...] } — see src/lib/notes/blocks.ts. */
  content: jsonb("content").$type<{ blocks: unknown[] }>().notNull().default({ blocks: [] }),
  /** Plain text of the note, for search and AI. */
  text: text("text").notNull().default(""),
  /** note | daily | template */
  kind: text("kind").notNull().default("note"),
  /** A daily note's day. */
  day: date("day"),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  pinned: boolean("pinned").notNull().default(false),
  /** Read-only until unlocked. */
  locked: boolean("locked").notNull().default(false),
  /** private | view (everyone in the workspace can read) | edit (and change) */
  visibility: text("visibility").notNull().default("private"),
  /** The page or record it belongs to: { module, href, label }. */
  attached: jsonb("attached").$type<{ module: string; href: string; label: string } | null>(),
  /** Notes this one links to with [[…]]. */
  links: uuid("links").array().notNull().default(sql`'{}'::uuid[]`),
  /** Published read-only at /n/<token>. */
  publicToken: text("public_token"),
  remindAt: timestamp("remind_at", { withTimezone: true }),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  words: integer("words").notNull().default(0),
  version: integer("version").notNull().default(1),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("notes_owner_idx").on(t.orgId, t.ownerId, t.updatedAt),
  index("notes_attached_idx").on(t.orgId, sql`(${t.attached}->>'href')`),
  uniqueIndex("notes_daily_uq").on(t.orgId, t.ownerId, t.day).where(sql`${t.kind} = 'daily' and ${t.deletedAt} is null`),
  uniqueIndex("notes_public_uq").on(t.publicToken),
]);

/** Members a note is shared with, and whether they may change it. */
export const noteShares = pgTable("note_shares", {
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** view | edit */
  role: text("role").notNull().default("view"),
  createdAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.noteId, t.userId] }), index("note_shares_user_idx").on(t.userId)]);

/** Earlier versions of a note (kept when it changes after a pause, and before a restore). */
export const noteVersions = pgTable("note_versions", {
  id: id(),
  noteId: uuid("note_id").notNull().references(() => notes.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  content: jsonb("content").$type<{ blocks: unknown[] }>().notNull(),
  words: integer("words").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("note_versions_note_idx").on(t.noteId, t.createdAt)]);

// ── Requisitions: what a client owes you, chased by email until it's in ───────

/** A workspace's Requisitions settings (the mailbox reminders go from, the default schedule, how replies are read) and its numbering. */
export const rqSettings = pgTable("rq_settings", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  counters: jsonb("counters").$type<Record<string, number>>().notNull().default({}),
});

/**
 * One requisition: a client, the list of things asked for, and the reminder
 * schedule that keeps asking until everything required is in. Replies are
 * matched to it by the email thread; the client's link (with `nonce`) lets
 * them see the list and upload.
 */
export const rqLists = pgTable(
  "rq_lists",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull().default(""),
    clientName: text("client_name").notNull().default(""),
    clientEmail: text("client_email").notNull(),
    cc: text("cc").array().notNull().default([]),
    contactId: uuid("contact_id").references(() => crmContacts.id, { onDelete: "set null" }),
    companyId: uuid("company_id").references(() => crmCompanies.id, { onDelete: "set null" }),
    /** draft | active | paused | completed | cancelled */
    status: text("status").notNull().default("draft"),
    dueDate: date("due_date"),
    schedule: jsonb("schedule").$type<Record<string, unknown>>().notNull().default({}),
    /** The connected mailbox reminders go from (replies are read from it); null = the platform's address. */
    mailAccountId: uuid("mail_account_id").references(() => mailAccounts.id, { onDelete: "set null" }),
    /** The email conversation, once the first request has gone. */
    threadId: uuid("thread_id"),
    lastMailId: uuid("last_mail_id"),
    nextReminderAt: timestamp("next_reminder_at", { withTimezone: true }),
    remindersSent: integer("reminders_sent").notNull().default(0),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    lastReplyAt: timestamp("last_reply_at", { withTimezone: true }),
    firstViewedAt: timestamp("first_viewed_at", { withTimezone: true }),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    views: integer("views").notNull().default(0),
    /** Why reminders stopped or paused, in words. */
    note: text("note").notNull().default(""),
    nonce: text("nonce").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("rq_lists_number_uq").on(t.orgId, t.number), index("rq_lists_org_status_idx").on(t.orgId, t.status), index("rq_lists_due_idx").on(t.nextReminderAt).where(sql`status = 'active'`), index("rq_lists_email_idx").on(t.orgId, sql`lower(client_email)`), index("rq_lists_thread_idx").on(t.threadId)],
);

/** One thing asked for. pending | received | review (looks received — check it) | rejected (asked again) | waived. */
export const rqItems = pgTable(
  "rq_items",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    listId: uuid("list_id").notNull().references(() => rqLists.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    required: boolean("required").notNull().default(true),
    status: text("status").notNull().default("pending"),
    /** upload | email | manual */
    receivedVia: text("received_via"),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    /** Why it was marked (the AI's reason, or the team's note to the client when rejected). */
    note: text("note").notNull().default(""),
    confidence: real("confidence"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rq_items_list_idx").on(t.listId, t.position)],
);

/** Emails each way: the request and reminders sent (their Message-ID matches replies), and the client's replies read. */
export const rqMessages = pgTable(
  "rq_messages",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    listId: uuid("list_id").notNull().references(() => rqLists.id, { onDelete: "cascade" }),
    /** out | in */
    direction: text("direction").notNull(),
    /** request | reminder | thanks | reply */
    kind: text("kind").notNull(),
    n: integer("n").notNull().default(0),
    /** The message in Mail (when sent from or read in a connected mailbox). */
    mailMessageId: uuid("mail_message_id"),
    /** The Message-ID header. */
    headerId: text("header_id"),
    fromEmail: text("from_email").notNull().default(""),
    to: text("to").array().notNull().default([]),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    /** For replies: what was understood from them. */
    analysis: jsonb("analysis").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("rq_messages_list_idx").on(t.listId, t.createdAt), uniqueIndex("rq_messages_header_uq").on(t.orgId, t.headerId).where(sql`header_id is not null and header_id <> ''`), uniqueIndex("rq_messages_mail_uq").on(t.mailMessageId).where(sql`mail_message_id is not null`)],
);

/** Files the client sent: uploaded on their link, or attached to a reply. */
export const rqFiles = pgTable(
  "rq_files",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    listId: uuid("list_id").notNull().references(() => rqLists.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => rqItems.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull().default(""),
    data: bytea("data").notNull(),
    /** upload | email */
    source: text("source").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("rq_files_list_idx").on(t.listId)],
);

/** Everything that happened to a requisition, in order: the tracking timeline. */
export const rqEvents = pgTable(
  "rq_events",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    listId: uuid("list_id").notNull().references(() => rqLists.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("rq_events_list_idx").on(t.listId, t.createdAt)],
);

/** Saved lists to start from (KYC, ITR filing, a monthly GST pack…). */
export const rqTemplates = pgTable("rq_templates", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  title: text("title").notNull().default(""),
  message: text("message").notNull().default(""),
  items: jsonb("items").$type<{ title: string; description?: string; required?: boolean }[]>().notNull().default([]),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});
