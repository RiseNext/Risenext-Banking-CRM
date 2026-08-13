import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Database } from "../db/index.js";
import { permissions, rolePermissions, roles, userBankAccess, users } from "../db/schema/index.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { PERMISSIONS, SUPER_ADMIN_ROLE_KEY } from "../lib/permissions.js";

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  status: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  roleLevel: number;
  roleIsSystem: boolean;
  permissions: ReadonlySet<string>;
  /** `null` means unrestricted (holder of system.access_all_banks). */
  bankIds: string[] | null;
}

/**
 * Resolves everything authorisation needs in one round trip. Called per request
 * rather than trusted from the JWT so that a permission revoked by an admin
 * takes effect on the user's very next request instead of at token expiry.
 */
export async function loadAuthContext(db: Database, userId: string): Promise<AuthContext> {
  const [row] = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      status: users.status,
      deletedAt: users.deletedAt,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      roleLevel: roles.level,
      roleIsSystem: roles.isSystem,
      roleIsActive: roles.isActive,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);

  if (!row) throw unauthorized("Account no longer exists");
  if (row.status !== "Active") throw forbidden("Account is not active");
  if (!row.roleIsActive) throw forbidden("Assigned role has been disabled");

  const grantedRows = await db
    .select({ key: permissions.key })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, row.roleId));

  const granted = new Set(grantedRows.map((p) => p.key));

  let bankIds: string[] | null = null;
  if (!granted.has(PERMISSIONS.system.accessAllBanks)) {
    const assignments = await db
      .select({ bankId: userBankAccess.bankId })
      .from(userBankAccess)
      .where(eq(userBankAccess.userId, userId));
    bankIds = assignments.map((a) => a.bankId);
  }

  return {
    userId: row.userId,
    email: row.email,
    name: row.name,
    status: row.status,
    roleId: row.roleId,
    roleKey: row.roleKey,
    roleName: row.roleName,
    roleLevel: row.roleLevel,
    roleIsSystem: row.roleIsSystem,
    permissions: granted,
    bankIds,
  };
}

export const hasPermission = (ctx: AuthContext, key: string): boolean => ctx.permissions.has(key);

export const hasEveryPermission = (ctx: AuthContext, keys: string[]): boolean =>
  keys.every((k) => ctx.permissions.has(k));

export function assertPermission(ctx: AuthContext, key: string): void {
  if (!ctx.permissions.has(key)) {
    throw forbidden(`Missing required permission: ${key}`);
  }
}

export const isUnscoped = (ctx: AuthContext): boolean => ctx.bankIds === null;

/**
 * The single choke point for tenant isolation.
 *
 * Returns a WHERE fragment restricting a query to banks the caller may see.
 * A user with zero bank assignments gets `inArray(column, [])`, which Drizzle
 * renders as a false predicate — they see nothing, rather than everything.
 */
export function bankScope(ctx: AuthContext, column: PgColumn): SQL | undefined {
  if (ctx.bankIds === null) return undefined;
  return inArray(column, ctx.bankIds.length > 0 ? ctx.bankIds : [NO_BANK_SENTINEL]);
}

/** A UUID that can never exist, used to force an empty result set. */
const NO_BANK_SENTINEL = "00000000-0000-0000-0000-000000000000";

/**
 * Called before reading or writing any bank-owned record, including on the
 * bankId supplied in a request body. This is what stops an executive changing
 * a path parameter or a payload field to reach another bank's data.
 */
export function assertBankAccess(ctx: AuthContext, bankId: string | null | undefined): void {
  if (ctx.bankIds === null) return;
  if (!bankId) throw forbidden("A bank must be specified for this operation");
  if (!ctx.bankIds.includes(bankId)) {
    throw forbidden("You do not have access to this resource");
  }
}

export function assertBankAccessMany(ctx: AuthContext, bankIds: string[]): void {
  for (const id of bankIds) assertBankAccess(ctx, id);
}

/**
 * ROLE HIERARCHY
 *
 * Lower level == more authority. An actor may only operate on a subject whose
 * role level is strictly greater than their own. Consequences that fall out of
 * this one rule, with no role names in the code:
 *   - Admin (10) cannot create or edit another Admin (10)  -> not strictly >
 *   - Admin (10) cannot touch Super Admin (0)              -> not strictly >
 *   - Admin (10) can manage Manager (20) and below         -> strictly >
 *   - Super Admin (0) holds system.manage_any_user         -> bypasses
 */
export function assertCanManageRoleLevel(ctx: AuthContext, targetLevel: number): void {
  if (hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) return;
  if (targetLevel <= ctx.roleLevel) {
    throw forbidden("You cannot manage a user at or above your own role level");
  }
}

export function assertCanAssignRole(
  ctx: AuthContext,
  target: { key: string; level: number; isSystem: boolean },
): void {
  if (target.key === SUPER_ADMIN_ROLE_KEY && !hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) {
    throw forbidden("Only a Super Admin may assign the Super Admin role");
  }
  assertCanManageRoleLevel(ctx, target.level);
}

/**
 * Prevents privilege escalation via role editing: you cannot grant a permission
 * you do not hold yourself. Without this, an Admin with roles.assign_permissions
 * could mint a role holding system.access_all_banks and assign it to themselves.
 */
export function assertCanGrantPermissions(ctx: AuthContext, keys: string[]): void {
  if (hasPermission(ctx, PERMISSIONS.system.manageAnyUser)) return;
  const escalations = keys.filter((k) => !ctx.permissions.has(k));
  if (escalations.length > 0) {
    throw forbidden(
      `You cannot grant permissions you do not hold: ${escalations.slice(0, 5).join(", ")}`,
    );
  }
}

/** System roles are renameable but never deletable and never key-editable. */
export function assertRoleMutable(role: { isSystem: boolean }, operation: "delete" | "rekey"): void {
  if (role.isSystem) {
    throw forbidden(`The ${operation === "delete" ? "deletion" : "re-keying"} of a system role is not permitted`);
  }
}

export const scopeSummary = (ctx: AuthContext): string =>
  ctx.bankIds === null ? "all banks" : `${ctx.bankIds.length} assigned bank(s)`;
