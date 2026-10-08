# Emotion Rides reviews

Visitors submit a review on the homepage. It stays **pending** until you approve it from your phone. Nothing is seeded. If the KV binding is missing, the Reviews section stays hidden and the rest of the page is unchanged.

## Cloudflare setup (Pages project `emotionrides`)

Do this in the dashboard for **Production** and **Preview**, then redeploy. Bindings and secrets are not in this repo.

### 1. KV namespace

1. Cloudflare dashboard → **Storage & databases** → **KV** → **Create namespace**.
2. Namespace name: `emotionrides-reviews`.
3. **Workers & Pages** → **emotionrides** → **Settings** → **Bindings** → **Add** → **KV namespace**.
4. Variable name (exact): `REVIEWS`
5. KV namespace: `emotionrides-reviews`
6. Save, and repeat for the Preview environment if it has its own bindings.

### 2. Signing secret

**Settings** → **Variables and Secrets** → **Add** → type **Secret**.

- Name (exact): `REVIEW_SIGNING_SECRET`
- Value: a long random string, for example the output of `openssl rand -base64 32`

Add it for Production and Preview. This signs the Approve / Delete links. Do not commit it.

### 3. Email (already used by the drop list)

Required (existing):

- `RESEND_API_KEY`

Optional (existing):

- `RESEND_FROM` — default `Emotion Rides <drops@updates.emotionrides.com>`
- `RESEND_OWNER` — default `sbackemoto@gmail.com` (owner notifications go here)

### 4. Redeploy

Bindings apply on the next successful Pages deploy. `GET /api/reviews` returns `{ "configured": false }` until `REVIEWS`, `REVIEW_SIGNING_SECRET`, and `RESEND_API_KEY` are all set, and the homepage section stays hidden.

## What you do when a review comes in

1. Email arrives at sbackemoto@gmail.com from the existing Resend setup.
2. Tap **Approve** or **Delete**. The link opens a confirm page (mail apps prefetch GET links, so the first tap does not publish anything).
3. Tap the button. Approved reviews show on the homepage. Deleted ones do not.
4. The optional email is in that message only. It is never rendered on the site.

Links expire after 30 days.

## Spam

- Honeypot field `fax_number` (same idea as the drop-list form). Filled = pretend success, store nothing.
- 5 submissions per hour per IP, counted in the `REVIEWS` KV namespace.

## Checks

```bash
node --test functions/_lib/reviews.test.js
```
