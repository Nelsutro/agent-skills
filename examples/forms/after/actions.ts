'use server'

import { db } from '@/lib/db'
import { requireSession } from '@/lib/auth'
import { CheckoutSchema } from './schema'

export type CheckoutState = {
  ok: boolean
  values?: Record<string, string>
  errors?: Record<string, string[] | undefined>
  message?: string
}

export async function checkoutAction(previous: CheckoutState, formData: FormData): Promise<CheckoutState> {
  const values = Object.fromEntries(formData)
  const parsed = CheckoutSchema.safeParse(values)

  if (!parsed.success) {
    return {
      ok: false,
      values,
      errors: parsed.error.flatten().fieldErrors,
    }
  }

  const session = await requireSession()
  const idempotencyKey = String(formData.get('idempotencyKey') ?? '')
  const priceCents = await priceFor(parsed.data.quantity)

  const order = await db.order.create({
    data: {
      ...parsed.data,
      userId: session.userId,
      priceCents,
      idempotencyKey,
    },
  })

  return { ok: true, message: `Order ${order.id} created` }
}

async function priceFor(quantity: number) {
  return quantity * 1999
}
