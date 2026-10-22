'use client'

const MAX_BYTES = 5 * 1024 * 1024

export function UploadForm({ action, pending }: { action: (formData: FormData) => void; pending: boolean }) {
  return (
    <form action={action}>
      <label htmlFor="attachment">Attachment</label>
      <input
        id="attachment"
        type="file"
        name="attachment"
        accept="application/pdf,image/png,image/jpeg"
        aria-describedby="attachment-hint"
      />
      <p id="attachment-hint">PDF, PNG, or JPEG. Maximum 5 MB.</p>
      <p>Limit: {MAX_BYTES} bytes.</p>
      <button type="submit" disabled={pending}>Upload</button>
    </form>
  )
}
