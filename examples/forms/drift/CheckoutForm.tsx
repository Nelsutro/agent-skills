'use client'

export function CheckoutForm({ action, pending }: { action: (formData: FormData) => void; pending: boolean }) {
  return (
    <form action={action}>
      <input type="hidden" name="idempotencyKey" value="key-1" />

      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required />

      <label htmlFor="name">Full name</label>
      <input id="name" name="name" type="text" autoComplete="name" required />

      <label htmlFor="quantity">Quantity</label>
      <input id="quantity" name="quantity" type="number" min={1} required />

      <label htmlFor="coupon">Coupon</label>
      <input id="coupon" name="coupon" type="text" required />

      <label htmlFor="nickname">Nickname</label>
      <input id="nickname" name="nickname" type="text" />

      <button type="submit" disabled={pending}>Pay</button>
    </form>
  )
}
