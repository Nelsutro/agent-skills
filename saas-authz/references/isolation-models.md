# Isolation models

Choose the isolation model before writing queries. Retrofitting tenancy is expensive.

## Shared schema with `tenant_id`

One database, one schema, a tenant column on every tenant-owned table.

**Pros**

- Cheapest to operate and scale for many small tenants
- One migration path; easy cross-tenant analytics for the operator
- Works well with RLS, Prisma, Drizzle, and serverless Postgres

**Cons**

- One missing `where` clause leaks data
- Noisy neighbors share resources
- Per-tenant restore is hard
- Regulatory isolation is logical, not physical

**Requirements**

- Non-null tenant column on every owned table
- Tenant as the leading column of composite indexes
- RLS enabled and forced as defense in depth
- All queries scoped through a repository/policy layer
- Tenant-scoped caches, jobs, storage, and search

## Schema per tenant

Each tenant gets a Postgres schema (`tenant_<id>`) with identical tables.

**Pros**

- Stronger logical separation; easier per-tenant export
- Per-tenant migrations and indexes possible
- Backups/restores can target one schema

**Cons**

- Migration fan-out; hundreds of schemas are painful
- Connection/search_path management per request
- Cross-tenant reporting is harder
- ORMs vary in schema support

**Use when** tenant count is moderate and isolation matters more than operational simplicity.

## Database per tenant

Each tenant has its own database (or cluster).

**Pros**

- Strongest isolation; per-tenant encryption, backups, regions
- No shared noisy neighbors
- Easy to delete a tenant permanently

**Cons**

- Highest cost and operational burden
- Connection pooling and migrations multiply
- Cross-tenant features require a separate data plane

**Use when** enterprise contracts, data residency, or compliance demand it. Offer it as a tier, not the default.

## Hybrid (pool + silo)

Most tenants share a pool; enterprise tenants get a dedicated schema/database. Route by tenant at the connection layer.

Requirements:

- A tenant registry mapping tenant → data plane
- Consistent migrations across planes
- Tests that run against both pool and silo
- Clear rules about which features differ

## Decision checklist

| Question | Shared | Schema | Database |
| --- | --- | --- | --- |
| Thousands of small tenants | Yes | No | No |
| Strong regulatory isolation | No | Maybe | Yes |
| Per-tenant restore | Hard | Yes | Yes |
| Simple migrations | Yes | Medium | Hard |
| Cross-tenant operator analytics | Easy | Medium | Hard |
| Lowest cost | Yes | Medium | No |

## Tenant-owned vs global data

Classify every table:

- **Tenant-owned**: invoices, projects, members, API keys, files, settings. Has `tenant_id`, RLS, scoped queries.
- **User-owned**: profile, preferences. Scoped by `user_id`; may still belong to a tenant.
- **Global**: countries, currencies, plans, feature flags, permission definitions. No tenant column; never join them into tenant data without a scope.
- **Join tables**: carry the tenant column too, or enforce it through a composite foreign key.

Prevent cross-tenant references at the database level:

```sql
-- Composite key makes it impossible to reference another tenant's row
alter table projects add constraint projects_tenant_id_id_key unique (tenant_id, id);

alter table tasks
  add column tenant_id uuid not null,
  add constraint tasks_project_fk
    foreign key (tenant_id, project_id)
    references projects (tenant_id, id)
    on delete cascade;
```

Application-level checks are not enough; make invalid states unrepresentable where possible.

## Tenant lifecycle

- **Create**: provision tenant, owner membership, defaults, in one transaction.
- **Rename**: no impact on IDs; avoid using the slug as the primary key.
- **Suspend**: block access at the session/middleware layer, keep data.
- **Delete**: soft delete with retention, then hard delete; remove storage, caches, search documents, queues, and backups per policy.
- **Export**: per-tenant export must not include other tenants.
- **Restore**: know whether you can restore one tenant without rolling back others.

## Noisy neighbors

In shared models, enforce per-tenant limits:

- Rate limits keyed by tenant and user
- Query timeouts and statement timeouts
- Row/export limits
- Background job concurrency per tenant
- Storage quotas
- Expensive report generation queued, not synchronous

## Migration rules

- Add the tenant column as nullable, backfill, then set `NOT NULL`.
- Add indexes concurrently where supported.
- Never deploy code that queries a tenant column before the backfill completes.
- Keep RLS policies in migrations, reviewed like code.
- Test migrations against two tenants and verify no data crosses.

## Anti-patterns

- Adding `tenant_id` only to the "main" tables and forgetting child tables
- Nullable tenant columns ("legacy rows")
- Using email domain as the tenant boundary
- Deriving tenant from a subdomain without validating membership
- Sharing a cache or search index across tenants without scoping
- One database per tenant without automating migrations
- Cross-tenant foreign keys with no composite constraint
