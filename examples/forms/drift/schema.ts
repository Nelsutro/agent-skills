import { z } from 'zod'

export const DriftSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
  coupon: z.string().optional(),
  phone: z.string().min(7),
})
