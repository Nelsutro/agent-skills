'use client'

export function UploadForm({ action, pending }: { action: (formData: FormData) => void; pending: boolean }) {
  return (
    <form action={action}>
      <label htmlFor="attachment">Attachment</label>
      <input id="attachment" type="file" name="attachment" />
      <button type="submit" disabled={pending}>Upload</button>
    </form>
  )
}
