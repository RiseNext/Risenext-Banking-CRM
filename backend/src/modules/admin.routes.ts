import { Router } from "express";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/index.js";
import {
  auditLogs,
  banks,
  permissions as permissionsTable,
  recycleBinEntries,
  rolePermissions,
  roles,
  notifications,
  teamMembers,
  teams,
  userBankAccess,
  users,
} from "../db/schema/index.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { hashPassword, passwordProblems, randomToken } from "../lib/password.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { authOf, requireAuth, requirePermission } from "../middleware/auth.js";
import {
  assertBankAccess,
  assertCanAssignRole,
  assertCanGrantPermissions,
  assertCanManageRoleLevel,
  assertRoleMutable,
  bankScope,
  hasPermission,
} from "../services/access.js";
import { diff, recordAudit } from "../services/audit.js";
import { permanentDelete, restore, softDelete } from "../services/recycle-bin.js";

/* ------------------------------------------------------------------ users */

export const usersRouter = Router();
usersRouter.use(requireAuth);

const userInput = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email().max(255),
  phone: z.string().trim().max(20).optional().nullable(),
  employeeCode: z.string().trim().min(2).max(40),
  roleId: z.string().uuid(),
  branch: z.string().trim().max(160).optional().nullable(),
  status: z.enum(["Active", "Inactive"]).default("Active"),
  joinedOn: z.coerce.date().optional().nullable(),
  target: z.coerce.number().int().min(0).default(0),
  achieved: z.coerce.number().int().min(0).default(0),
  avatarColor: z.string().trim().max(20).optional().nullable(),
  bankIds: z.array(z.string().uuid()).optional(),
  password: z.string().min(1).max(512).optional(),
});

async function roleOrThrow(roleId: string) {
  const [role] = await getDb().select().from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!role) throw notFound("Role not found");
  return role;
}

/** The target's role level, which is what the hierarchy rule operates on. */
async function targetUserRole(userId: string) {
  const [row] = await getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      roleId: roles.id,
      roleKey: roles.key,
      roleLevel: roles.level,
      roleIsSystem: roles.isSystem,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!row) throw notFound("User not found");
  return row;
}

usersRouter.get("/", requirePermission(PERMISSIONS.users.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const db = getDb();
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
        status: z.enum(["Active", "Inactive"]).optional(),
      })
      .parse(req.query);

    const filters: SQL[] = [isNull(users.deletedAt)];
    if (query.status) filters.push(eq(users.status, query.status));

    // A scoped user only sees colleagues who share at least one of their banks.
    if (ctx.bankIds !== null) {
      const ids = ctx.bankIds;
      filters.push(
        ids.length === 0
          ? sql`false`
          : sql`exists (select 1 from user_bank_access uba where uba.user_id = ${users.id} and uba.bank_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}))`,
      );
    }

    const where = and(...filters);
    const [{ total = 0 } = {}] = await db.select({ total: count() }).from(users).where(where);

    const rows = await db
      .select({
        id: users.id,
        employeeCode: users.employeeCode,
        name: users.name,
        email: users.email,
        phone: users.phone,
        branch: users.branch,
        status: users.status,
        joinedOn: users.joinedOn,
        target: users.target,
        achieved: users.achieved,
        avatarColor: users.avatarColor,
        lastLoginAt: users.lastLoginAt,
        roleId: roles.id,
        roleKey: roles.key,
        roleName: roles.name,
        roleLevel: roles.level,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(where)
      .orderBy(asc(users.name))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const access = rows.length
      ? await db
          .select({ userId: userBankAccess.userId, bankId: userBankAccess.bankId })
          .from(userBankAccess)
          .where(inArray(userBankAccess.userId, rows.map((r) => r.id)))
      : [];

    res.json({
      // password_hash is never selected, so it cannot leak through this route.
      data: rows.map((row) => ({
        ...row,
        assignedBanks: access.filter((a) => a.userId === row.id).map((a) => a.bankId),
      })),
      meta: { page: query.page, pageSize: query.pageSize, total },
    });
  } catch (error) {
    next(error);
  }
});

usersRouter.post("/", requirePermission(PERMISSIONS.users.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = userInput.parse(req.body);
    const db = getDb();

    const role = await roleOrThrow(input.roleId);
    // THE rule. An Admin (level 10) fails here for another Admin or a Super
    // Admin, without the word "admin" appearing anywhere.
    assertCanAssignRole(ctx, role);

    if (input.bankIds?.length) {
      for (const bankId of input.bankIds) assertBankAccess(ctx, bankId);
    }

    const password = input.password ?? randomToken(12);
    const problems = passwordProblems(password);
    if (input.password && problems.length > 0) {
      throw badRequest(`Password ${problems.join(", ")}`);
    }

    const created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          employeeCode: input.employeeCode,
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          passwordHash: await hashPassword(password),
          roleId: role.id,
          branch: input.branch ?? null,
          status: input.status,
          joinedOn: input.joinedOn ?? new Date(),
          target: input.target,
          achieved: input.achieved,
          avatarColor: input.avatarColor ?? null,
          mustChangePassword: true,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();

      if (input.bankIds?.length) {
        await tx.insert(userBankAccess).values(
          input.bankIds.map((bankId) => ({ userId: user!.id, bankId, assignedBy: ctx.userId })),
        );
      }

      await recordAudit(tx as never, ctx, req, {
        action: "created",
        recordType: "user",
        recordId: user!.id,
        summary: `Created user ${input.name} with role ${role.name}`,
        metadata: { roleKey: role.key, bankCount: input.bankIds?.length ?? 0 },
      });

      return user!;
    });

    res.status(201).json({
      data: { id: created.id, email: created.email, name: created.name },
      // Returned once, never stored in the clear, never logged.
      temporaryPassword: input.password ? undefined : password,
    });
  } catch (error) {
    next(error);
  }
});

usersRouter.patch("/:id", requirePermission(PERMISSIONS.users.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const input = userInput.partial().parse(req.body);
    const db = getDb();

    const target = await targetUserRole(id);
    // Blocks editing a peer or a superior, which is what stops an Admin
    // touching a Super Admin.
    assertCanManageRoleLevel(ctx, target.roleLevel);

    if (input.roleId && input.roleId !== target.roleId) {
      const nextRole = await roleOrThrow(input.roleId);
      // Blocks promotion above the actor's own authority.
      assertCanAssignRole(ctx, nextRole);
    }

    if (input.password) {
      const problems = passwordProblems(input.password);
      if (problems.length > 0) throw badRequest(`Password ${problems.join(", ")}`);
    }

    const [before] = await db.select().from(users).where(eq(users.id, id)).limit(1);

    const [after] = await db
      .update(users)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.branch !== undefined ? { branch: input.branch } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.achieved !== undefined ? { achieved: input.achieved } : {}),
        ...(input.avatarColor !== undefined ? { avatarColor: input.avatarColor } : {}),
        ...(input.password
          ? {
              passwordHash: await hashPassword(input.password),
              passwordChangedAt: new Date(),
              mustChangePassword: true,
            }
          : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(users.id, id))
      .returning();

    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "user",
      recordId: id,
      summary: `Updated user ${after?.name}`,
      changes: diff(before as Record<string, unknown>, after as Record<string, unknown>),
    });

    res.json({ data: { id: after?.id, name: after?.name, email: after?.email } });
  } catch (error) {
    next(error);
  }
});

/** Bank assignment. Replaces `Employee.assignedBanks[]` from the frontend. */
usersRouter.put("/:id/banks", requirePermission(PERMISSIONS.users.assign), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const { bankIds } = z.object({ bankIds: z.array(z.string().uuid()) }).parse(req.body);
    const db = getDb();

    const target = await targetUserRole(id);
    assertCanManageRoleLevel(ctx, target.roleLevel);
    // You cannot grant access to a bank you cannot see yourself.
    for (const bankId of bankIds) assertBankAccess(ctx, bankId);

    const existing = await db
      .select({ bankId: banks.id })
      .from(banks)
      .where(and(inArray(banks.id, bankIds.length ? bankIds : [id]), isNull(banks.deletedAt)));
    if (bankIds.length && existing.length !== bankIds.length) {
      throw badRequest("One or more banks do not exist");
    }

    await db.transaction(async (tx) => {
      const previous = await tx
        .select({ bankId: userBankAccess.bankId })
        .from(userBankAccess)
        .where(eq(userBankAccess.userId, id));

      await tx.delete(userBankAccess).where(eq(userBankAccess.userId, id));
      if (bankIds.length) {
        await tx
          .insert(userBankAccess)
          .values(bankIds.map((bankId) => ({ userId: id, bankId, assignedBy: ctx.userId })));
      }

      await recordAudit(tx as never, ctx, req, {
        action: "assigned",
        recordType: "user",
        recordId: id,
        summary: `Set bank access for ${target.name} to ${bankIds.length} bank(s)`,
        changes: { banks: { from: previous.map((p) => p.bankId), to: bankIds } },
      });
    });

    res.json({ data: { userId: id, bankIds } });
  } catch (error) {
    next(error);
  }
});

usersRouter.delete("/:id", requirePermission(PERMISSIONS.users.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    if (id === ctx.userId) throw badRequest("You cannot delete your own account");

    const target = await targetUserRole(id);
    assertCanManageRoleLevel(ctx, target.roleLevel);

    // The last active super admin must not be removable, or the system locks out.
    if (target.roleIsSystem) {
      const [{ remaining = 0 } = {}] = await getDb()
        .select({ remaining: count() })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(and(eq(roles.isSystem, true), eq(users.status, "Active"), isNull(users.deletedAt)));
      if (remaining <= 1) throw conflict("The last active Super Admin cannot be removed");
    }

    await getDb()
      .update(users)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId, status: "Inactive" })
      .where(eq(users.id, id));

    await recordAudit(getDb(), ctx, req, {
      action: "deleted",
      recordType: "user",
      recordId: id,
      summary: `Deactivated user ${target.name}`,
    });

    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ roles */

export const rolesRouter = Router();
rolesRouter.use(requireAuth);

rolesRouter.get("/", requirePermission(PERMISSIONS.roles.view), async (_req, res, next) => {
  try {
    const db = getDb();
    const rows = await db
      .select()
      .from(roles)
      .where(isNull(roles.deletedAt))
      .orderBy(asc(roles.level));
    const grants = await db
      .select({ roleId: rolePermissions.roleId, key: permissionsTable.key })
      .from(rolePermissions)
      .innerJoin(permissionsTable, eq(rolePermissions.permissionId, permissionsTable.id));

    res.json({
      data: rows.map((role) => ({
        ...role,
        permissions: grants.filter((g) => g.roleId === role.id).map((g) => g.key),
      })),
    });
  } catch (error) {
    next(error);
  }
});

rolesRouter.get("/permissions", requirePermission(PERMISSIONS.roles.view), async (_req, res, next) => {
  try {
    const rows = await getDb()
      .select()
      .from(permissionsTable)
      .orderBy(asc(permissionsTable.resource), asc(permissionsTable.action));
    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
});

const roleInput = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_]{1,40}$/, "Key must be lowercase snake_case"),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().nullable(),
  level: z.coerce.number().int().min(1).max(1000),
  permissions: z.array(z.string()).default([]),
});

rolesRouter.post("/", requirePermission(PERMISSIONS.roles.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = roleInput.parse(req.body);
    const db = getDb();

    // A new role may not be created at or above the creator's own authority.
    assertCanManageRoleLevel(ctx, input.level);
    // ...and may not carry a permission the creator does not hold.
    assertCanGrantPermissions(ctx, input.permissions);

    const created = await db.transaction(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({
          key: input.key,
          name: input.name,
          description: input.description ?? null,
          level: input.level,
          isSystem: false,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();

      if (input.permissions.length) {
        const perms = await tx
          .select({ id: permissionsTable.id })
          .from(permissionsTable)
          .where(inArray(permissionsTable.key, input.permissions));
        await tx
          .insert(rolePermissions)
          .values(perms.map((p) => ({ roleId: role!.id, permissionId: p.id, grantedBy: ctx.userId })));
      }

      await recordAudit(tx as never, ctx, req, {
        action: "created",
        recordType: "role",
        recordId: role!.id,
        summary: `Created role ${input.name}`,
        metadata: { permissions: input.permissions.length },
      });
      return role!;
    });

    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

rolesRouter.patch("/:id", requirePermission(PERMISSIONS.roles.edit), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const input = roleInput.partial().omit({ key: true }).parse(req.body);
    const db = getDb();

    const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!role) throw notFound("Role not found");
    assertCanManageRoleLevel(ctx, role.level);
    if (input.level !== undefined) assertCanManageRoleLevel(ctx, input.level);

    const [after] = await db
      .update(roles)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        // A system role's level is fixed; everything else about it is editable.
        ...(input.level !== undefined && !role.isSystem ? { level: input.level } : {}),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(eq(roles.id, id))
      .returning();

    await recordAudit(db, ctx, req, {
      action: "updated",
      recordType: "role",
      recordId: id,
      summary: `Renamed role ${role.name} to ${after?.name}`,
      changes: diff(role as Record<string, unknown>, after as Record<string, unknown>),
    });

    res.json({ data: after });
  } catch (error) {
    next(error);
  }
});

rolesRouter.put(
  "/:id/permissions",
  requirePermission(PERMISSIONS.roles.assignPermissions),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const { permissions: keys } = z.object({ permissions: z.array(z.string()) }).parse(req.body);
      const db = getDb();

      const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
      if (!role) throw notFound("Role not found");
      if (role.isSystem) throw forbidden("The system role's permissions cannot be edited");

      assertCanManageRoleLevel(ctx, role.level);
      assertCanGrantPermissions(ctx, keys);

      await db.transaction(async (tx) => {
        const perms = keys.length
          ? await tx
              .select({ id: permissionsTable.id, key: permissionsTable.key })
              .from(permissionsTable)
              .where(inArray(permissionsTable.key, keys))
          : [];
        if (perms.length !== keys.length) throw badRequest("One or more permissions do not exist");

        await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        if (perms.length) {
          await tx
            .insert(rolePermissions)
            .values(perms.map((p) => ({ roleId: id, permissionId: p.id, grantedBy: ctx.userId })));
        }

        await recordAudit(tx as never, ctx, req, {
          action: "updated",
          recordType: "role",
          recordId: id,
          summary: `Set ${keys.length} permission(s) on role ${role.name}`,
          changes: { permissions: { from: "(replaced)", to: keys } },
        });
      });

      res.json({ data: { roleId: id, permissions: keys } });
    } catch (error) {
      next(error);
    }
  },
);

rolesRouter.delete("/:id", requirePermission(PERMISSIONS.roles.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const db = getDb();

    const [role] = await db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!role) throw notFound("Role not found");
    assertRoleMutable(role, "delete");
    assertCanManageRoleLevel(ctx, role.level);

    const [{ holders = 0 } = {}] = await db
      .select({ holders: count() })
      .from(users)
      .where(and(eq(users.roleId, id), isNull(users.deletedAt)));
    if (holders > 0) {
      throw conflict(`This role is still assigned to ${holders} user(s). Reassign them first.`);
    }

    await db.delete(roles).where(eq(roles.id, id));
    await recordAudit(db, ctx, req, {
      action: "deleted",
      recordType: "role",
      recordId: id,
      summary: `Deleted role ${role.name}`,
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ------------------------------------------------------------------ teams */

export const teamsRouter = Router();
teamsRouter.use(requireAuth);

teamsRouter.get("/", requirePermission(PERMISSIONS.teams.view), async (_req, res, next) => {
  try {
    const db = getDb();
    const rows = await db.select().from(teams).where(isNull(teams.deletedAt)).orderBy(asc(teams.name));
    const members = await db
      .select({ teamId: teamMembers.teamId, userId: teamMembers.userId, name: users.name })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .where(isNull(users.deletedAt));

    res.json({
      data: rows.map((team) => ({
        ...team,
        members: members.filter((m) => m.teamId === team.id),
      })),
    });
  } catch (error) {
    next(error);
  }
});

const teamInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  leaderId: z.string().uuid().optional().nullable(),
  status: z.enum(["Active", "Inactive"]).default("Active"),
});

teamsRouter.post("/", requirePermission(PERMISSIONS.teams.create), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const input = teamInput.parse(req.body);
    const db = getDb();
    const [created] = await db
      .insert(teams)
      .values({ ...input, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await recordAudit(db, ctx, req, {
      action: "created",
      recordType: "team",
      recordId: created?.id,
      summary: `Created team ${created?.name}`,
    });
    res.status(201).json({ data: created });
  } catch (error) {
    next(error);
  }
});

teamsRouter.put("/:id/members", requirePermission(PERMISSIONS.teams.assign), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    const { userIds } = z.object({ userIds: z.array(z.string().uuid()) }).parse(req.body);
    const db = getDb();

    const [team] = await db
      .select()
      .from(teams)
      .where(and(eq(teams.id, id), isNull(teams.deletedAt)))
      .limit(1);
    if (!team) throw notFound("Team not found");

    await db.transaction(async (tx) => {
      await tx.delete(teamMembers).where(eq(teamMembers.teamId, id));
      if (userIds.length) {
        await tx
          .insert(teamMembers)
          .values(userIds.map((userId) => ({ teamId: id, userId, assignedBy: ctx.userId })));
      }
      await recordAudit(tx as never, ctx, req, {
        action: "assigned",
        recordType: "team",
        recordId: id,
        summary: `Set ${userIds.length} member(s) on team ${team.name}`,
      });
    });

    res.json({ data: { teamId: id, userIds } });
  } catch (error) {
    next(error);
  }
});

teamsRouter.delete("/:id", requirePermission(PERMISSIONS.teams.delete), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const id = req.params.id as string;
    await getDb()
      .update(teams)
      .set({ deletedAt: new Date(), deletedBy: ctx.userId })
      .where(eq(teams.id, id));
    await recordAudit(getDb(), ctx, req, {
      action: "deleted",
      recordType: "team",
      recordId: id,
      summary: "Deleted team",
    });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/* ----------------------------------------------------------- recycle bin */

export const recycleBinRouter = Router();
recycleBinRouter.use(requireAuth);

recycleBinRouter.get("/", requirePermission(PERMISSIONS.recycleBin.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const filters: SQL[] = [isNull(recycleBinEntries.restoredAt), isNull(recycleBinEntries.purgedAt)];
    // Bin entries carrying no bank (e.g. service providers) stay visible only to
    // unscoped users; scoped users see their own banks' entries.
    const scope = bankScope(ctx, recycleBinEntries.bankId);
    if (scope) filters.push(scope);

    const rows = await getDb()
      .select()
      .from(recycleBinEntries)
      .where(and(...filters))
      .orderBy(desc(recycleBinEntries.deletedAt))
      .limit(200);

    res.json({
      data: rows.map((row) => ({
        ...row,
        // The full snapshot is not needed by the list UI and may contain PII.
        snapshot: undefined,
        daysRemaining: Math.max(
          0,
          Math.ceil((row.purgeAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
        ),
      })),
    });
  } catch (error) {
    next(error);
  }
});

recycleBinRouter.post(
  "/:id/restore",
  requirePermission(PERMISSIONS.recycleBin.restore),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const [entry] = await getDb()
        .select()
        .from(recycleBinEntries)
        .where(eq(recycleBinEntries.id, id))
        .limit(1);
      if (!entry) throw notFound("Recycle bin entry not found");
      if (entry.bankId) assertBankAccess(ctx, entry.bankId);

      await restore(getDb(), ctx, req, id);
      res.json({ data: { restored: true, recordType: entry.recordType } });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Hard delete. The frontend shows a plain "Are you sure?" with No/Yes and no
 * typing, per the brief, so the confirmation lives in the UI; the API requires
 * an explicit flag so a stray DELETE cannot purge anything by accident.
 */
recycleBinRouter.post(
  "/:id/permanent-delete",
  requirePermission(PERMISSIONS.recycleBin.permanentDelete),
  async (req, res, next) => {
    try {
      const ctx = authOf(req);
      const id = req.params.id as string;
      const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body);
      if (!confirm) throw badRequest("Confirmation is required");

      const [entry] = await getDb()
        .select()
        .from(recycleBinEntries)
        .where(eq(recycleBinEntries.id, id))
        .limit(1);
      if (!entry) throw notFound("Recycle bin entry not found");
      if (entry.bankId) assertBankAccess(ctx, entry.bankId);

      await permanentDelete(getDb(), ctx, req, id);
      res.json({ data: { purged: true, recordType: entry.recordType } });
    } catch (error) {
      next(error);
    }
  },
);

/* ------------------------------------------------------------ audit logs */

export const auditRouter = Router();
auditRouter.use(requireAuth);

/** Read-only by construction: there is no write route, and the table rejects
 *  UPDATE and DELETE at the database level. */
auditRouter.get("/", requirePermission(PERMISSIONS.auditLogs.view), async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(50),
        recordType: z.string().trim().max(60).optional(),
        recordId: z.string().trim().max(60).optional(),
        action: z.string().trim().max(60).optional(),
      })
      .parse(req.query);

    const filters: SQL[] = [];
    if (query.recordType) filters.push(eq(auditLogs.recordType, query.recordType));
    if (query.recordId) filters.push(eq(auditLogs.recordId, query.recordId));
    if (query.action) filters.push(eq(auditLogs.action, query.action));

    if (ctx.bankIds !== null) {
      const ids = ctx.bankIds;
      filters.push(
        ids.length === 0
          ? sql`false`
          : sql`(${auditLogs.bankId} is null and ${auditLogs.actorId} = ${ctx.userId}) or ${auditLogs.bankId} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`,
      );
    }

    const where = filters.length ? and(...filters) : undefined;
    const rows = await getDb()
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.occurredAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    res.json({ data: rows, meta: { page: query.page, pageSize: query.pageSize } });
  } catch (error) {
    next(error);
  }
});

export { hasPermission, softDelete };

/* --------------------------------------------------------- notifications */

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * Notifications are per-user, not per-bank, so they are not bank-scoped —
 * a user only ever sees rows addressed to them.
 */
notificationsRouter.get("/", async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const rows = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(100);

    res.json({
      data: rows,
      meta: { total: rows.length, unread: rows.filter((r) => !r.read).length },
    });
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/read-all", async (req, res, next) => {
  try {
    const ctx = authOf(req);
    await getDb()
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.userId), eq(notifications.read, false)));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

notificationsRouter.post("/:id/read", async (req, res, next) => {
  try {
    const ctx = authOf(req);
    const [updated] = await getDb()
      .update(notifications)
      .set({ read: true, readAt: new Date() })
      .where(
        and(eq(notifications.id, req.params.id as string), eq(notifications.userId, ctx.userId)),
      )
      .returning();
    if (!updated) throw notFound("Notification not found");
    res.json({ data: updated });
  } catch (error) {
    next(error);
  }
});
