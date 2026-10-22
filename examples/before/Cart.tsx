export function Cart({ count, total, user }: { count: number; total: number; user: { name: string } }) {
  return (
    <section aria-label="Shopping cart">
      <h2>Your cart</h2>
      <p>Hello, {user.name}. You have {count} items.</p>
      <button title="Remove all items">Clear cart</button>
      <input placeholder="Coupon code" />
      <p>Total: ${total.toFixed(2)}</p>
      <button>Continue to checkout</button>
    </section>
  )
}
