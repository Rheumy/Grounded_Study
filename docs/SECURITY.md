# Security

## Upload Protection

- MIME + file signature validation (`file-type`).
- Max file size, page count, and image dimension caps via env vars.
- No remote fetches from user input (SSRF avoidance).

## Access Control

- Auth enforced on `/dashboard/*` and `/api/*`.
- Webhook endpoints are explicitly excluded from auth middleware.
- Admin-only endpoint uses `ADMIN_EMAIL`.

## Storage

- Local uploads are private and gitignored.
- Vercel Blob is private and only enabled when configured.

## Content Safety

- Uploaded content is treated as untrusted.
- UI never renders raw HTML from uploads.

## Headers

- CSP, X-Frame-Options, HSTS, and related headers set in `next.config.mjs`.

## Secrets

- Never stored in client code.
- Gitleaks runs in CI and via pre-commit hook.
