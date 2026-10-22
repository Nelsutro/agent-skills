import { z } from 'zod'

export const CheckoutSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(120),
  quantity: z.coerce.number().int().min(1).max(20),
  coupon: z.string().trim().max(40).optional(),
})

export type CheckoutInput = z.infer<typeof CheckoutSchema>
