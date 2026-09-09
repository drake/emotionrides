# Emotion Rides drop list (Resend)

## Live pieces
- Homepage form → `POST /api/subscribe` (Pages Function `functions/api/subscribe.js`)
- Sending domain: `updates.emotionrides.com`
- From: `Emotion Rides <drops@updates.emotionrides.com>`
- Owner notify: `sbackemoto@gmail.com`

## Cloudflare Pages secrets (project `emotionrides`)
Required:
- `RESEND_API_KEY`

Optional:
- `RESEND_FROM=Emotion Rides <drops@updates.emotionrides.com>`
- `RESEND_OWNER=sbackemoto@gmail.com`
- `RESEND_AUDIENCE_ID=db0a0022-4857-413f-9517-e9128bf1f088` (Emotion Rides Drop List)

Never commit the API key.

## Drop day / discount codes
1. Create the discount code in Big Cartel (shop stays closed until you’re ready).
2. Resend → Broadcasts → write the email → include unsubscribe + physical address in the footer.
3. Send to the Emotion Rides Drop List audience / contacts.

## CAN-SPAM
Marketing broadcasts need a real postal address (PO Box / virtual mailbox — not the home address). Add it in Resend before the first blast.

## Smoke test after deploy
1. Open https://emotionrides.com/#drop-list
2. Join with a real inbox you control
3. Confirm welcome email + owner ping to sbackemoto@gmail.com
