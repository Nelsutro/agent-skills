# Data access patterns

The data layer should make the tenant-scoped path the default and the unscoped path hard to write.

## Repository functions that require context

```ts
type TenantContext = { tenantId: string; userId: string; permissions: Set<string> }

export function invoices(ctx: TenantContext) {
  return {
    list: () =>
      db.invoice.findMany({
        where: { organizationId: ctx.tenantId },
        orderBy: { createdAt: 'desc' },
      }),

    get: (id: string) =>
      db.invoice.findFirst({
        where: { id, organizationId: ctx.tenantId },
      }),

    create: (input: NewInvoice) =>
      db.invoice.create({
        data: { ...input, organizationId: ctx.tenantId },
      }),

    remove: (id: string) =>
      db.invoice.deleteMany({
        where: { id, organizationId: ctx.tenantId },
      }),
  }
}
```

- `get` uses `findFirst` with the tenant, not `findUnique({ where: { id } })`.
- `remove` uses `deleteMany` + `count` so a cross-tenant ID is a no-op rather than an exception that reveals existence.
- Input types must not include `organizationId`; strip it if present.

## Prisma

### Client extension

```ts
import { Prisma } from '@prisma/client'

const TENANT_MODELS = new Set(['Invoice', 'Project', 'Task', 'ApiKey'])

export function tenantClient(ctx: TenantContext) {
  return db.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_MODELS.has(model)) return query(args)
          const a = args as Record<string, unknown>

          if (operation === 'create') {
            a.data = { ...(a.data as object), organizationId: ctx.tenantId }
          } else if (operation === 'createMany') {
            const data = Array.isArray(a.data) ? a.data : [a.data]
            a.data = data.map((row) => ({ ...row, organizationId: ctx.tenantId }))
          } else if (operation === 'upsert') {
            a.where = { ...(a.where as object), organizationId: ctx.tenantId }
            a.create = { ...(a.create as object), organizationId: ctx.tenantId }
          } else if ('where' in a) {
            a.where = { ...(a.where as object), organizationId: ctx.tenantId }
          } else {
            a.where = { organizationId: ctx.tenantId }
          }

          return query(a)
        },
      },
    },
  })
}
```

Caveats:

- Extension applies to top-level model operations. Nested writes (`create: { tasks: { create: ... } }`) and `$queryRaw` are not covered automatically.
- `findUnique` requires a unique `where`. Adding a non-unique field breaks it; use a compound unique (`@@unique([organizationId, id])`) or switch to `findFirst`.
- `update`/`delete` also require a unique `where`; prefer `updateMany`/`deleteMany` with the tenant and check `count`.
- Do not let user input override `organizationId`: apply the tenant last.
- The extension is defense in depth; keep explicit filters in sensitive repositories.
- Use `$transaction` to keep read-check-write atomic.

### Compound unique

```prisma
model Invoice {
  id             String   @id @default(uuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  @@unique([organizationId, id])
  @@index([organizationId, createdAt])
}
```

## Drizzle

```ts
import { and, eq } from 'drizzle-orm'

export function invoiceRepo(ctx: TenantContext) {
  return {
    list: () => db.select().from(invoices).where(eq(invoices.organizationId, ctx.tenantId)),
    get: (id: string) =>
      db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.tenantId))),
    remove: (id: string) =>
      db.delete(invoices).where(and(eq(invoices.id, id), eq(invoices.organizationId, ctx.tenantId))).returning({ id: invoices.id }),
  }
}
```

- Build a `tenantWhere` helper and use it everywhere.
- For dynamic filters, use `.$dynamic()` and always start with the tenant condition.
- Never interpolate raw identifiers from user input; use `sql` with parameters.

## Raw SQL

```ts
// Bad: no tenant predicate
db.$queryRaw`select * from invoices where id = ${id}`

// Good: tenant predicate, parameterized
db.$queryRaw`
  select * from invoices
  where id = ${id} and organization_id = ${ctx.tenantId}
`
```

- Raw queries bypass ORM extensions; RLS is the safety net if configured.
- Parameterize every value. Never build SQL by string concatenation.
- For `IN` lists, use `= any(${ids})` with a typed array.

## Supabase

- In request handlers, create a client with the user's access token so RLS applies:

```ts
import { createServerClient } from '@supabase/ssr'

const supabase = createServerClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${accessToken}` } },
  cookies: { /* ... */ },
})
```

- The service-role key bypasses RLS. Use it only in trusted jobs or admin operations with an explicit tenant filter and audit.
- Store `organization_id` in `app_metadata`, not `user_metadata` (users can edit the latter).
- Verify membership in a `security definer` helper or claim, and test with a real JWT.

## Background jobs

- The payload includes `tenantId` and `actorUserId`.
- The worker loads the tenant context, verifies the tenant still exists and is active, then re-checks permission for user-initiated jobs.
- Jobs must not accept a tenant ID from an untrusted source without verifying the enqueuer had access.
- Idempotency keys include the tenant.

## Caches

- Key format: `tenant:{tenantId}:resource:{id}:v{n}`.
- Never cache a cross-tenant query result under a shared key.
- Invalidate on writes, membership changes, role changes, and tenant suspension.
- Beware of CDN caching of authenticated responses.

## Object storage

- Prefix keys: `tenants/{tenantId}/invoices/{invoiceId}.pdf`.
- Authorize before signing a URL; keep expiry short.
- Do not accept arbitrary keys from the client; construct them server-side.
- Bucket policies should not allow listing across tenants.

## Search

- Documents include `tenant_id` as a filterable field.
- Every query applies the tenant filter at the search engine, not after fetching.
- Vector databases: namespace or metadata filter by tenant; verify recall cannot cross tenants.
- Reindex jobs carry the tenant and do not batch across tenants without an explicit filter.

## GraphQL and REST

- Resolvers receive context with `tenantId`; never read tenant from arguments.
- For nested resources, load the parent scoped to the tenant, then authorize the child against the parent.
- Batch loaders must include the tenant in the cache key.
- REST: ignore client-supplied `tenantId` in body/query; use the session.

## Transactions

- Read the object with the tenant scope and perform the write in the same transaction.
- Use conditional writes (`where id = ... and organization_id = ...`) and check affected rows.
- Do not hold a transaction open across network calls.

## Logging

- Log `tenantId` and `actorUserId` on mutations.
- Never log access tokens, invite tokens, passwords, or full PII.
- Redact query parameters that may contain secrets.

## Anti-patterns

- `findUnique({ where: { id } })` in a tenant system
- Tenant ID from `req.body` or `req.query`
- ORM extension that only covers reads
- Nested writes that skip the tenant
- Raw SQL concatenation
- Service-role client in handlers
- Cache keys without tenant
- Job payloads without tenant and no re-validation
- Storage paths built from client input
- Search queries that filter tenant after fetching results
