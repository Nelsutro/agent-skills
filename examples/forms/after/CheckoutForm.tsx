'use client'

import { useActionState } from 'react'
import { checkoutAction, type CheckoutState } from './actions'

const initialState: CheckoutState = { ok: false }

export function CheckoutForm({ idempotencyKey }: { idempotencyKey: string }) {
  const [state, action, pending] = useActionState(checkoutAction, initialState)

  return (
    <form action={action} noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={state.values?.email}
        aria-invalid={state.errors?.email ? true : undefined}
        aria-describedby={state.errors?.email ? 'email-error' : undefined}
      />
      {state.errors?.email ? <p id="email-error" role="alert">{state.errors.email[0]}</p> : null}

      <label htmlFor="name">Full name</label>
      <input
        id="name"
        name="name"
        type="text"
        autoComplete="name"
        defaultValue={state.values?.name}
        aria-invalid={state.errors?.name ? true : undefined}
        aria-describedby={state.errors?.name ? 'name-error' : undefined}
      />
      {state.errors?.name ? <p id="name-error" role="alert">{state.errors.name[0]}</p> : null}

      <label htmlFor="quantity">Quantity</label>
      <input
        id="quantity"
        name="quantity"
        type="number"
        min={1}
        max={20}
        defaultValue={state.values?.quantity ?? '1'}
        aria-invalid={state.errors?.quantity ? true : undefined}
        aria-describedby={state.errors?.quantity ? 'quantity-error' : undefined}
      />
      {state.errors?.quantity ? <p id="quantity-error" role="alert">{state.errors.quantity[0]}</p> : null}

      <label htmlFor="coupon">Coupon</label>
      <input
        id="coupon"
        name="coupon"
        type="text"
        defaultValue={state.values?.coupon}
        aria-invalid={state.errors?.coupon ? true : undefined}
        aria-describedby={state.errors?.coupon ? 'coupon-error' : undefined}
      />
      {state.errors?.coupon ? <p id="coupon-error" role="alert">{state.errors.coupon[0]}</p> : null}

      {state.message ? <p role="alert">{state.message}</p> : null}

      <button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? 'Paying...' : 'Pay'}
      </button>
    </form>
  )
}
