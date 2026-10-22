import { db } from './db'

export async function getInvoice(id: string) {
  return db.invoice.findUnique({ where: { id } })
}

export async function listProjects() {
  return db.project.findMany()
}

export async function deleteTask(id: string) {
  return db.task.delete({ where: { id } })
}

export async function searchInvoices(amount: number) {
  return db.$queryRaw`SELECT * FROM invoices WHERE amount_cents > ${amount}`
}
