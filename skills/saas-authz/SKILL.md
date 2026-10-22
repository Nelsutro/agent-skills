---
name: saas-authz
description: Multi-tenant authorization and isolation for SaaS apps. Use when designing or reviewing tenant isolation, RBAC/ABAC permissions, Postgres row-level security (RLS), organization or workspace scoping, role checks, invitation flows, audit logs, or cross-tenant data leaks and IDOR. Covers Prisma, Drizzle, Supabase, and raw SQL.
license: MIT
---

# SaaS authorization and multi-tenancy

Authorization bugs are data breaches. The goal is simple to state and hard to achieve: **no request can read or mutate another tenant's data, and no user can perform an action their role does not allow**, even if the UI is bypassed, an ID is guessed, a background job runs, or a query forgets a filter.

## When to Use This Skill

Use when the user asks to:

- Add organizations, workspaces, teams, or tenants to a SaaS
- Design or review RBAC, permissions, roles, or ABAC policies
- Scope queries by `tenant_id` / `organization_id`
- Set up Postgres or Supabase row-level security (RLS)
- Fix an IDOR, cross-tenant leak, or privilege escalation
- Build invitation and membership flows
- Add audit logs or "who can do what" checks
- Review a Prisma/Drizzle data access layer for missing tenant filters

Related references are in `references/` and scripts in `scripts/`. Read only what the task needs. Paths are relative to this skill's directory.

## Non-negotiables

1. **Enforce on the server.** UI hiding is UX, not authorization. Every mutation and read goes through a server-side check.
2. **Derive the tenant from the authenticated session**, not from a request body, query parameter, header, or client-supplied `tenantId`. Verify membership in that tenant on every request.
3. **Deny by default.** A missing policy, unknown role, or absent permission means no. Allowlists, not denylists.
4. **Check at the object level, not only the route level.** Knowing the user can "read invoices" is not enough; verify this invoice belongs to their tenant and they may read it.
5. **Scope at the data layer.** Every query against tenant-owned data carries the tenant filter. RLS is defense in depth, not a substitute for correct queries.
6. **One authoritative permission model.** Do not scatter `role === 'admin'` checks across components and endpoints; centralize them in a policy function and reuse it.
7. **Never trust IDs from the client.** Treat every `id` as hostile; a lookup by primary key alone is a vulnerability in a multi-tenant system.
8. **Tenant context is request-scoped.** No module-level mutable "current tenant" on the server. Concurrent requests will leak context.

## Workflow

### 1. Model the tenancy

Decide where the tenant boundary lives and write it down:

- What is a tenant? Organization, workspace, account, project?
- Can a user belong to multiple tenants? What is the "active" tenant?
- What data is tenant-owned, user-owned, or global?
- What is the isolation requirement: logical, regulatory, or physical?

Isolation options and trade-offs: `references/isolation-models.md`.

Typical schema:

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table memberships (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  amount_cents bigint not null,
  created_at timestamptz not null default now()
);

create index invoices_org_created_idx on invoices (organization_id, created_at desc);
```

Every tenant-owned table has a non-null tenant column, indexed as the leading column of its common access paths.

### 2. Establish tenant context

Resolve the tenant once per request, from authenticated state:

```ts
type TenantContext = {
  userId: string
  tenantId: string
  role: Role
  permissions: Set<Permission>
}

async function requireTenant(req: Request): Promise<TenantContext> {
  const session = await getSession(req) // verified cookie/JWT
  if (!session) throw new UnauthorizedError()

  const tenantId = session.activeTenantId // set only by the server after membership verification
  const membership = await db.membership.findUnique({
    where: { userId_tenantId: { userId: session.userId, tenantId } },
  })
  if (!membership) throw new ForbiddenError()

  return {
    userId: session.userId,
    tenantId,
    role: membership.role,
    permissions: permissionsFor(membership.role),
  }
}
```

Rules:

- Switching tenants is a server-side action that verifies membership and then updates the session/active tenant.
- Do not accept `tenantId` from the URL for access decisions; use it only to *look up* the membership, and reject if it does not match the session or if the user is not a member.
- For stateless JWTs, a tenant claim is fine only if it is signed and revocation is handled. Prefer verifying membership against the database for sensitive operations.
- Propagate context explicitly through function arguments or `AsyncLocalStorage` inside a request scope. Never a global variable.

### 3. Enforce in one policy layer

Define permissions as `resource:action` and check them in a single function:

```ts
type Permission =
  | 'invoice:read' | 'invoice:write' | 'invoice:delete'
  | 'member:invite' | 'member:remove'
  | 'settings:read' | 'settings:write'
  | 'billing:manage'

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ['invoice:read', 'invoice:write', 'invoice:delete', 'member:invite', 'member:remove', 'settings:read', 'settings:write', 'billing:manage'],
  admin: ['invoice:read', 'invoice:write', 'invoice:delete', 'member:invite', 'member:remove', 'settings:read', 'settings:write'],
  member: ['invoice:read', 'invoice:write', 'settings:read'],
  viewer: ['invoice:read', 'settings:read'],
}

export function can(ctx: TenantContext, permission: Permission): boolean {
  return ctx.permissions.has(permission)
}

export function assertCan(ctx: TenantContext, permission: Permission): void {
  if (!can(ctx, permission)) throw new ForbiddenError()
}
```

Then combine permission checks with object checks:

```ts
const invoice = await db.invoice.findFirst({
  where: { id, organizationId: ctx.tenantId },
})
if (!invoice) throw new NotFoundError() // do not reveal that it exists elsewhere
assertCan(ctx, 'invoice:write')
```

Return `404` rather than `403` for objects belonging to another tenant; it avoids confirming existence.

Authorization models (RBAC, ABAC, ReBAC), custom roles, and policy engines: `references/authorization-model.md`.

### 4. Scope the data access layer

Make the safe path the easy path:

- Prefer repository functions that take `ctx` and always include the tenant filter.
- With Prisma, use a client extension to inject the tenant into every query, and still keep explicit filters in sensitive paths.
- With Drizzle, wrap queries in a helper that adds `eq(table.organizationId, ctx.tenantId)`.
- With Supabase, rely on RLS and the user-scoped client; never use the service-role key in request handlers.
- Raw SQL must include the tenant predicate explicitly; parameterize values.

```ts
// Prisma: defence in depth
const scoped = db.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args)
        if (operation === 'create' || operation === 'createMany') {
          // set tenantId from ctx, never from input
          return query(applyTenantToCreate(args, ctx.tenantId))
        }
        return query(applyTenantToWhere(args, ctx.tenantId))
      },
    },
  },
})
```

Details and caveats (nested writes, `findUnique` compound keys, raw queries, transactions): `references/data-access.md`.

### 5. Add database-level isolation

RLS blocks queries that forget the filter, including ad-hoc SQL and compromised application code:

```sql
alter table invoices enable row level security;
alter table invoices force row level security;

create policy invoices_tenant_isolation on invoices
  using (organization_id = current_setting('app.tenant_id', true)::uuid)
  with check (organization_id = current_setting('app.tenant_id', true)::uuid);
```

Set the tenant per transaction, not per connection:

```sql
begin;
select set_config('app.tenant_id', $1, true);
-- queries
commit;
```

With pooled connections, `SET` outside a transaction leaks the tenant to the next request. Use `SET LOCAL` / `set_config(..., true)` inside the transaction, or a dedicated role per tenant.

RLS patterns, Supabase specifics, roles, bypasses, performance, and tests: `references/postgres-rls.md`.

### 6. Close the cross-cutting leak surfaces

Tenant scoping is not only the main ORM query. Audit:

- **Caches**: cache keys include the tenant (`tenant:{id}:invoice:{id}`), or use per-tenant namespaces.
- **Queues/jobs**: the job payload carries `tenantId`; the worker re-establishes context and re-checks permissions for user-initiated jobs.
- **Object storage**: keys are prefixed by tenant; signed URLs are short-lived and scoped; never trust a path from the client.
- **Search**: indexes store the tenant and every query filters it; check vector databases too.
- **Logs/metrics**: tenant ID is a label, but never log secrets or full PII.
- **Exports/PDFs/emails**: generated in the tenant context; links are unguessable and expiring.
- **Webhooks**: inbound events map to a tenant explicitly; outbound payloads never mix tenants.
- **Admin tools**: impersonation is explicit, audited, time-boxed, and cannot silently switch tenant.
- **Bulk operations**: `updateMany`, `deleteMany`, imports, and CSV exports carry the tenant filter.
- **GraphQL/REST nesting**: every resolver re-checks the parent object's tenant, not just the root.

### 7. Audit and observe

Log security-relevant events with `actorUserId`, `tenantId`, `action`, `resourceType`, `resourceId`, `result`, `ip`, `userAgent`, and timestamp. Make the audit log append-only and queryable per tenant. Never log tokens, passwords, or full request bodies.

### 8. Test the boundary

Write negative tests, not just happy paths:

- User A cannot read/update/delete tenant B's object by ID.
- A member cannot perform owner-only actions.
- A removed member loses access immediately.
- A user with two tenants cannot use a token from tenant A to access tenant B.
- A background job or export cannot cross tenants.
- RLS blocks a raw query without `app.tenant_id`.
- Invitations cannot be replayed, guessed, or used after expiry.

Full matrix and examples: `references/testing.md`.

After changing queries, run:

```bash
node scripts/scan-tenant-scope.mjs src
node scripts/check-rls.mjs db/migrations
```

Both are heuristics; review the output.

## Isolation models

| Model | Isolation | Cost | Use when |
| --- | --- | --- | --- |
| Shared schema + `tenant_id` | Logical | Low | Default for most SaaS; strong app + RLS discipline |
| Schema per tenant | Stronger logical | Medium | Noisy neighbors, per-tenant migrations, moderate tenant count |
| Database per tenant | Strong | High | Regulatory, enterprise, few large tenants |
| Hybrid (pool + silo) | Varies | High | Enterprise tier with dedicated resources |

Details: `references/isolation-models.md`.

## Authorization layers

| Layer | Purpose | Never rely on it alone |
| --- | --- | --- |
| UI | Hide unavailable actions | Yes, cosmetic only |
| Route/middleware | Require session and membership | No object-level checks |
| Service/policy | Permission + object checks | Primary enforcement |
| Data access | Tenant filter on every query | Defense in depth |
| Database RLS | Block unscoped queries | Defense in depth |
| Audit | Detect and investigate | After the fact |

## Review checklist

- [ ] Tenant derived from verified session, not client input
- [ ] Membership verified on every request; tenant switch is server-side
- [ ] Every tenant-owned table has a non-null tenant column and an index
- [ ] Every query and mutation includes the tenant filter
- [ ] Object-level checks prevent IDOR; foreign objects return 404
- [ ] Permissions centralized; no scattered `role === 'admin'`
- [ ] Deny by default; unknown role/permission fails closed
- [ ] Admin/owner actions cannot be self-granted
- [ ] Invitations: hashed token, expiry, single use, role validated
- [ ] Removed members and revoked sessions lose access immediately
- [ ] RLS enabled **and forced**; policies use the session tenant; no `USING (true)`
- [ ] Pooled connections use transaction-scoped tenant settings
- [ ] Caches, jobs, storage, search, exports, and webhooks are tenant-scoped
- [ ] Audit log records actor, tenant, action, resource, and result
- [ ] Negative tests cover cross-tenant access and privilege escalation
- [ ] CI runs the scope and RLS checks

## Anti-patterns

- `where: { id }` without a tenant filter
- Trusting `tenantId` from the request body or query string
- `if (user.role === 'admin')` duplicated across handlers
- Hiding a button and calling it authorization
- Client-side route guards as the only check
- A global `currentTenant` variable on the server
- RLS enabled but never forced, with the app connecting as the table owner
- `USING (true)` policies to "make it work"
- `SET app.tenant_id` on a pooled connection outside a transaction
- Service-role Supabase client in normal request paths
- Cache keys without tenant, or a shared cache for tenant-specific responses
- Background jobs that assume the enqueuer's tenant without re-validating
- Returning `403` for another tenant's object, confirming its existence
- Invitation tokens stored in plaintext or reusable
- Bulk `deleteMany`/`updateMany` with a filter built from user input
- Audit logs that can be edited or deleted by tenant admins
- Testing only with one tenant

## Scripts

- `scan-tenant-scope.mjs` — flags ORM/raw queries that lack a tenant filter in the surrounding code.
- `check-rls.mjs` — checks SQL migrations for missing/disabled RLS, permissive policies, and missing `FORCE`.

Both support `--json`; the RLS checker exits non-zero on errors.
