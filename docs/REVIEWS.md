# Emotion Rides reviews

Visitors submit a clothing review on the homepage. It stays **pending** until you approve it from your phone. Nothing is seeded. If the KV binding is missing, the Reviews section stays hidden and the rest of the page is unchanged.

The form asks two clothing questions, and both show on approved cards:

- **Is it comfortable?** — Super comfy / Comfy / Okay / Not really
- **What do you like about it?** — the main text (4–600 characters)

Stars, a first name or nickname, an optional product (Hoodie, Tee, Jeans, Jorts), and an optional email (never shown publicly) stay on the form.

## Cloudflare (Pages project `emotionrides`)

Already set on **Production** and **Preview**. Bindings and secrets are not in this repo.

- KV namespace `emotionrides-reviews`, bound as `REVIEWS`
- Secret `REVIEW_SIGNING_SECRET` (signs the Approve / Delete links)
- Existing `RESEND_API_KEY`
- Optional `RESEND_FROM` — default `Emotion Rides <drops@updates.emotionrides.com>`
- Optional `RESEND_OWNER` — default `sbackemoto@gmail.com` (review notifications go here)

`GET /api/reviews` returns `{ "configured": false }` until `REVIEWS`, `REVIEW_SIGNING_SECRET`, and `RESEND_API_KEY` are all set, and the homepage section stays hidden.

The site is publicly open. `functions/_middleware.js` calls `context.next()` for every request.

## What you do when a review comes in

1. Email arrives at sbackemoto@gmail.com from the existing Resend setup. It includes both clothing answers.
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
