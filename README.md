# Rise Next Banking CRM

Monorepo: existing Next.js frontend (unmodified) + new production TypeScript backend.

```
frontend/   Next.js 16 App Router — UNMODIFIED, reference only until Step 3
backend/    Express 5 + Drizzle + PostgreSQL (Neon), deployed to Railway
docs/       FRONTEND_ANALYSIS.md — frontend audit and entity mapping
```

## Architecture

```
Vercel (Next.js)  ──HTTPS──>  Railway (Express API)  ──TLS──>  Neon (PostgreSQL)
  access token in memory        argon2id + JWT               migrations via
  refresh token httpOnly        permission checks            DIRECT_DATABASE_URL
```

Authorisation is resolved per request as `user → role → permissions`, plus a
bank-scope filter applied in the data layer. There is no `if (role === "admin")`
anywhere in the codebase; grep for it.

## Backend setup

```bash
cd backend
npm install
cp .env.example .env        # fill in DATABASE_URL and both JWT secrets
npm run db:migrate          # applies drizzle/*.sql
npm run db:seed             # permissions, default roles, bootstrap super admin
npm run dev
```

Generate secrets with `openssl rand -base64 48`. `JWT_ACCESS_SECRET` and
`JWT_REFRESH_SECRET` must differ; production boot refuses if they match.

### Environment variables

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon **pooled** endpoint (`-pooler`) for the app |
| `DIRECT_DATABASE_URL` | for migrations | Neon **direct** endpoint; DDL through the pooler can deadlock |
| `JWT_ACCESS_SECRET` | yes | ≥32 chars |
| `JWT_REFRESH_SECRET` | yes | ≥32 chars, must differ from the access secret |
| `ACCESS_TOKEN_TTL` | no | default `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | no | default `7` |
| `CORS_ORIGIN` | yes in prod | comma-separated allow-list; the Vercel URL |
| `AADHAAR_PEPPER` | yes in prod | rotating it invalidates Aadhaar duplicate detection |
| `RECYCLE_BIN_RETENTION_DAYS` | no | default `30` |
| `BOOTSTRAP_SUPERADMIN_EMAIL` / `_PASSWORD` | first boot only | user is created with `must_change_password` set; unset both afterwards |

Never commit `.env`. `.gitignore` covers it.

## Neon setup

1. Create a project; copy both the pooled and direct connection strings.
2. Put them in `DATABASE_URL` and `DIRECT_DATABASE_URL`.
3. `npm run db:migrate` then `npm run db:seed`.
4. Verify: `curl $API/api/health/ready` → `{"database":{"connected":true}}`.

The schema is reproducible from zero. Three migrations produce **27 tables,
121 indexes, 62 foreign keys, 49 unique indexes and 9 triggers**, and re-running
them is a no-op.

## Testing

```bash
cd backend
npm run typecheck && npm run lint && npm run build && npm test
```

The suite runs the shipped migration files against a real PostgreSQL 18 engine
(PGlite/WASM) — no external database needed. 82 tests across three files:

- `authorization.test.ts` — bank scoping under direct ID manipulation, role
  hierarchy, privilege-escalation blocking, Bank Reference ID uniqueness,
  recycle bin, audit-log immutability, Aadhaar masking.
- `workflow.test.ts` — the admin-cannot-escalate rules over HTTP, custom roles,
  the funding/verification/disbursement/settlement chain, Excel import.
- `frontend-contract.test.ts` — **replays every request the frontend actually
  issues**, with the same paths and query parameters, and asserts the response
  shapes match the frontend's TypeScript types. This is what catches a query
  parameter the API silently ignores or a page size it rejects, without needing
  a deployed environment. Add a call here whenever a page starts making one.

## Roles and permissions

Roles are rows, not code. `key` is the stable identity; `name` is a display label
the client may rename freely; `level` sets hierarchy (lower = more authority).

| key | name | level |
|---|---|---|
| `super_admin` | Super Admin | 0 (protected: cannot be deleted, re-keyed or deactivated, enforced by DB trigger) |
| `admin` | Admin | 10 |
| `manager` | Manager | 20 |
| `team_leader` | Team Leader | 30 |
| `executive` | Executive | 40 |

One rule produces the whole hierarchy: **an actor may only act on a subject whose
role level is strictly greater than their own**, unless they hold
`system.manage_any_user`. Admin (10) therefore cannot create another Admin (10) or
touch Super Admin (0), with no role names in the code.

`system.access_all_banks` is the bank-scope bypass. Because it is a permission and
not a role check, a custom "Group Auditor" role can be given read-everything access
without a code change.

Privilege escalation is blocked separately: you cannot grant a permission you do
not hold yourself.

## Data protection

- Passwords: argon2id (m=19456, t=2, p=1), never logged, never in audit diffs.
- Aadhaar: peppered SHA-256 + last 4 digits only. No raw Aadhaar in the database.
- No card numbers, no CVV, no bank credentials stored anywhere.
- Audit log is append-only, enforced by a `BEFORE UPDATE OR DELETE` trigger.
- Logger redacts `authorization`, `cookie`, `set-cookie`, and any `password*`,
  `token*` or `aadhaar*` field.

## API surface

| Mount | Notes |
|---|---|
| `/api/health`, `/api/health/ready` | liveness; readiness pings the database |
| `/api/auth` | login, refresh, logout, me, change-password |
| `/api/users` | CRUD + `PUT /:id/banks` bank assignment |
| `/api/roles` | CRUD + `PUT /:id/permissions` + `GET /permissions` catalogue |
| `/api/teams` | CRUD + `PUT /:id/members` |
| `/api/banks`, `/api/customers` | CRUD, scoped |
| `/api/loans` | CRUD + `POST /:id/approve` + `POST /:id/verification` |
| `/api/verifications`, `/api/bank-orders` | CRUD, scoped |
| `/api/disbursements`, `/api/settlements` | CRUD + approve |
| `/api/transactions`, `/api/ledger`, `/api/documents` | CRUD, scoped |
| `/api/funding-sources`, `/api/service-providers` | CRUD |
| `/api/recycle-bin` | list, `POST /:id/restore`, `POST /:id/permanent-delete` |
| `/api/audit-logs` | read-only |
| `/api/imports` | template, upload/validate, preview, confirm |
| `/api/dashboard` | `/stats`, `/loan-status`, `/bank-performance` |

Every scoped resource routes through one factory (`src/modules/scoped-resource.ts`),
so the WHERE clause that enforces bank isolation is assembled in exactly one place.

## Excel import

1. `GET /api/imports/template/customers` — download the template. Required columns
   are marked `*`; the template is generated from the same column definitions the
   validator uses, so the two cannot drift apart.
2. `POST /api/imports/customers` (multipart `file`) — parses, validates and stages
   every row. **Nothing is written to `customers`.** Returns counts for valid,
   invalid and duplicate rows plus a 50-row preview.
3. `GET /api/imports/:batchId` — the full staged set for the preview screen.
4. `POST /api/imports/:batchId/confirm` — inserts only rows staged `valid`, in one
   transaction. Bank access is re-checked at confirm time, batches expire after
   24 hours, and a second confirm returns 409.

A row referencing a bank the importer is not assigned to is marked invalid and
skipped — never silently reassigned.

## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env.local     # set NEXT_PUBLIC_API_URL to the backend URL
npm run dev
```

`NEXT_PUBLIC_API_URL` is the only variable the frontend needs. It is public by
design — no secret is ever shipped to the browser.

### How auth works in the browser

The access token lives in a module variable and is gone on refresh. The refresh
token is an httpOnly cookie the browser sends automatically and JavaScript cannot
read, so an XSS bug cannot exfiltrate a long-lived credential. On boot the app
calls `POST /api/auth/refresh` to restore the session.

Because Vercel and Railway are different sites, the refresh cookie is
`SameSite=None; Secure` in production. That requires `CORS_ORIGIN` on the backend
to name the exact Vercel origin — a wildcard will not work with credentials.

### Light / dark mode

`src/components/theme-script.tsx` runs before hydration and sets the theme class
on `<html>` from `localStorage`, falling back to the OS preference, so there is no
flash of the wrong theme. Light mode is unchanged from the original design. Dark
mode reuses the same layout, spacing and component structure; only the tokens in
the `.dark` block of `globals.css` differ, plus lightened status colours (the
light-mode greens and ambers fail contrast on the dark canvas) and a hairline
card ring in place of shadows that are invisible on dark.

## Vercel deployment

1. Point the existing project at this repo, root directory `frontend`.
2. Set `NEXT_PUBLIC_API_URL` to the Railway URL for Production and Preview.
3. Deploy. `next build` must pass; it does locally.

## Railway deployment

1. New service from this repo, root directory `backend`.
2. Build `npm ci && npm run build`, start `npm run start`.
3. Set every variable in `backend/.env.example` except the bootstrap pair, which
   should be set once, used, then removed.
4. Run `npm run db:migrate` then `npm run db:seed` against the Neon database.
5. Health check path `/api/health`.

## Deployment status

**Not deployed.** Neon (`console.neon.tech`) and Railway (`railway.app`) both
return HTTP 403 from this build environment's egress proxy, and no credentials
were supplied. Every local gate passes; nothing has been verified against a live
deployment, and no claim is made that it has.
