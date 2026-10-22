import { db } from './db'
import type { TenantContext } from './context'

export async function getInvoice(ctx: TenantContext, id: string) {
  return db.invoice.findFirst({
    where: { id, organizationId: ctx.tenantId },
  }) // tenant-scoped
}

export async function listProjects(ctx: TenantContext) {
  return db.project.findMany({ where: { organizationId: ctx.tenantId } })
}

export async function deleteTask(ctx: TenantContext, id: string) {
  return db.task.deleteMany({
    where: { id, organizationId: ctx.tenantId },
  })
}

export async function searchInvoices(ctx: TenantContext, amount: number) {
  return db.$queryRaw`
    SELECT * FROM invoices
    WHERE organization_id = ${ctx.tenantId}
      AND amount_cents > ${amount}
  `
}
