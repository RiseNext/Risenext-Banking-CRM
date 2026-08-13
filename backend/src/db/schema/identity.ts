import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/**
 * ROLES
 * -----
 * Roles are DATA, never code. Authorisation is resolved as:
 *   user -> role -> role_permissions -> permission.key
 *
 * `key`      stable machine identifier. Never changes, never shown to users.
 * `name`     display label. Fully renameable by Super Admin.
 * `level`    hierarchy depth. LOWER number == MORE authority. Super Admin = 0.
 *            A user may only act on users whose role.level is strictly greater
 *            than their own, and may only grant permissions they hold.
 * `isSystem` protects SUPER ADMIN (and any future system role) from rename to a
 *            different key, deletion, or permission removal.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    level: integer("level").notNull().default(100),
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("roles_key_unique").on(t.key),
    index("roles_level_idx").on(t.level),
    index("roles_deleted_at_idx").on(t.deletedAt),
  ],
);

/**
 * PERMISSIONS
 * Seeded catalogue. `key` follows `resource.action` (e.g. customers.create).
 */
export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    resource: text("resource").notNull(),
    action: text("action").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("permissions_key_unique").on(t.key),
    index("permissions_resource_idx").on(t.resource),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid("granted_by"),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index("role_permissions_permission_idx").on(t.permissionId),
  ],
);

/**
 * USERS
 * Replaces the frontend `Employee` interface. Employee-specific operational
 * fields (branch, target, achieved, avatarColor) are preserved so the existing
 * Employees screen can bind without redesign.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeCode: text("employee_code").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    branch: text("branch"),
    status: text("status").notNull().default("Active"),
    joinedOn: timestamp("joined_on", { withTimezone: true }),
    target: integer("target").notNull().default(0),
    achieved: integer("achieved").notNull().default(0),
    avatarColor: text("avatar_color"),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    // Partial unique: a soft-deleted user frees up their email/code again.
    uniqueIndex("users_email_unique")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.deletedAt} is null`),
    uniqueIndex("users_employee_code_unique")
      .on(t.employeeCode)
      .where(sql`${t.deletedAt} is null`),
    index("users_role_idx").on(t.roleId),
    index("users_status_idx").on(t.status),
    index("users_deleted_at_idx").on(t.deletedAt),
  ],
);

/**
 * REFRESH TOKENS — server-side session records so logout genuinely revokes.
 * Only the SHA-256 hash of the token is stored.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedByTokenHash: text("replaced_by_token_hash"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("refresh_tokens_hash_unique").on(t.tokenHash),
    index("refresh_tokens_user_idx").on(t.userId),
    index("refresh_tokens_expires_idx").on(t.expiresAt),
  ],
);

/**
 * TEAMS
 */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    leaderId: uuid("leader_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("Active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: uuid("deleted_by"),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("teams_name_unique")
      .on(sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index("teams_leader_idx").on(t.leaderId),
    index("teams_deleted_at_idx").on(t.deletedAt),
  ],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    assignedBy: uuid("assigned_by"),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    index("team_members_user_idx").on(t.userId),
  ],
);

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  teamMemberships: many(teamMembers),
  refreshTokens: many(refreshTokens),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  leader: one(users, { fields: [teams.leaderId], references: [users.id] }),
  members: many(teamMembers),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, { fields: [teamMembers.teamId], references: [teams.id] }),
  user: one(users, { fields: [teamMembers.userId], references: [users.id] }),
}));
