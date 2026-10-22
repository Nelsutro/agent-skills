'use client'

export function CheckoutForm({ error }: { error?: string }) {
  return (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <input type="email" placeholder="Email" />
      <input name="name" placeholder="Full name" />
      <input type="hidden" name="price" value="4999" />
      <label htmlFor="receipt">Receipt</label>
      <input id="receipt" type="file" name="receipt" />
      {error ? <p dangerouslySetInnerHTML={{ __html: error }} /> : null}
      <button type="submit">Pay</button>
    </form>
  )
}
