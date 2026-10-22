'use server'

import { db } from '@/lib/db'

export async function checkoutAction(formData: FormData) {
  await db.order.create({
    data: {
      email: String(formData.get('email')),
      name: String(formData.get('name')),
      priceCents: Number(formData.get('price')),
    },
  })
}
