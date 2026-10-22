# File uploads in forms

Uploads combine form validation, storage security, and performance. Treat every file as hostile until the server has verified it.

## Baseline

```html
<label for="avatar">Profile photo</label>
<input
  id="avatar"
  name="avatar"
  type="file"
  accept="image/png,image/jpeg,image/webp"
  aria-describedby="avatar-hint"
/>
<p id="avatar-hint">PNG, JPEG, or WebP. Maximum 5 MB.</p>
```

- Set `accept` as a hint, not a security control.
- Set a maximum size and count in the UI and enforce them on the server.
- Do not trust the filename, extension, or browser-reported MIME type.
- Use a real `<label>`; do not hide the input behind a div-only click target.

## Server validation

Check, in order:

1. Authentication and authorization.
2. Count and total size.
3. Declared size against the limit.
4. Magic bytes or a content-sniffing library for the real type.
5. Extension allowlist, if the type requires one.
6. Image dimensions and decompression limits.
7. Malware scanning for untrusted files.
8. Ownership and tenant scope.

Reject with a field-keyed error, not a generic 500.

## Storage keys

Never accept a path from the client.

```ts
const key = `tenants/${ctx.tenantId}/users/${ctx.userId}/${randomUUID()}`
```

- Prefix by tenant and owner.
- Use random identifiers, not user filenames.
- Keep the original filename only as metadata.
- Store files in a private bucket by default.
- Serve through short-lived signed URLs or an authenticated proxy.

## Presigned uploads

For large files, upload directly to object storage:

1. The client asks the server for a presigned URL.
2. The server authorizes the request and chooses the key.
3. The client uploads with the signed URL.
4. The client confirms completion.
5. The server verifies the object's size and type before attaching it.

Do not let the client choose the bucket, key, ACL, or content type in the signed request without validation. Keep signed URL lifetimes short.

## Multipart and resumable uploads

- Use multipart for large files and resumable protocols for unreliable networks.
- Limit part size and total parts.
- Clean up incomplete multipart uploads.
- Make completion idempotent.
- Record upload state on the server so a retry does not duplicate the attachment.

## Images

- Verify dimensions and decode limits before processing.
- Strip EXIF GPS and other sensitive metadata unless the product requires it.
- Generate thumbnails and responsive variants asynchronously.
- Do not process huge images synchronously in a request.
- Beware decompression bombs.
- Treat SVG as executable content: sanitize it or do not serve it inline.

## Malware and abuse

- Scan untrusted files before making them available.
- Enforce per-user and per-tenant quotas.
- Rate-limit uploads.
- Reject encrypted archives if the product does not need them.
- Do not let users overwrite another user's object by guessing a key.
- Log uploads without logging file contents.

## UX

- Show the selected filename and size.
- Show progress for large uploads.
- Allow cancel and retry.
- Preserve the rest of the form if an upload fails.
- Explain allowed types and limits before the user selects a file.
- Announce upload errors accessibly.
- Do not block the entire form while an image thumbnail is generated.

## Cleanup

- Delete orphaned uploads after a failed form submit.
- Expire drafts and their attachments.
- Remove old versions when replacing an avatar or document.
- Keep a retention policy for deleted tenant data.

## Testing

- Oversized file.
- Wrong real type with a spoofed extension.
- Zero-byte file.
- Filename with path traversal characters.
- Multiple files when only one is allowed.
- Duplicate completion request.
- Upload by a user outside the tenant.
- Signed URL reuse after expiry.
- Image with malicious metadata.
- SVG with script content.

## Anti-patterns

- `accept="image/*"` as the only validation.
- Trusting `file.type`.
- Storing uploads in a public bucket by default.
- Using the original filename as the storage key.
- Buffering a 1 GB file in memory.
- Returning the storage path to the client and accepting it back.
- Serving user SVG inline without sanitization.
- Processing images synchronously in the submit request.
- No cleanup for abandoned uploads.
