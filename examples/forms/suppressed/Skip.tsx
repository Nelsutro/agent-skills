'use client'

export function Skip({ action, pending }: { action: (formData: FormData) => void; pending: boolean }) {
  return (
    <form action={action}>
      <input name="nickname" /> {/* form-ok */}
      <button type="submit" disabled={pending}>Save</button>
    </form>
  )
}
