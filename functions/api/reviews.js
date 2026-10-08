/**
 * Public reviews.
 * GET  /api/reviews  → approved reviews only (no emails)
 * POST /api/reviews  → store as pending and email the owner
 *
 * Binding (Pages project "emotionrides"):
 *   REVIEWS   KV namespace
 * Secret:
 *   REVIEW_SIGNING_SECRET
 * Existing:
 *   RESEND_API_KEY
 *   RESEND_FROM   (optional)
 *   RESEND_OWNER  (optional, default sbackemoto@gmail.com)
 *
 * If REVIEWS, REVIEW_SIGNING_SECRET, or RESEND_API_KEY is missing,
 * GET returns configured:false so the homepage section stays hidden.
 */

import {
  OWNER_DEFAULT,
  RATE_LIMIT,
  RATE_WINDOW_SEC,
  TOKEN_TTL_MS,
  averageRating,
  clientIp,
  clientKey,
  denverStamp,
  isConfigured,
  ownerEmail,
  parseReview,
  signToken,
  stripHeader,
  toPublic,
} from "../_lib/reviews.js";

const ALLOWED = new Set([
  "https://emotionrides.com",
  "https://www.emotionrides.com",
  "https://shop.emotionrides.com",
]);

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get("Origin")) || "";
  const allow = ALLOWED.has(origin) ? origin : "https://emotionrides.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(request, status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(request),
      ...extra,
    },
  });
}

function emptyList() {
  return { configured: false, reviews: [], count: 0, average: null };
}

async function listApproved(kv) {
  const reviews = [];
  let cursor;
  for (let page = 0; page < 8; page++) {
    const listed = await kv.list({ prefix: "approved:", cursor, limit: 100 });
    const keys = (listed && listed.keys) || [];
    for (const key of keys) {
      const raw = await kv.get(key.name, "json");
      const pub = toPublic(raw);
      if (pub) reviews.push(pub);
    }
    if (!listed || listed.list_complete || !listed.cursor) break;
    cursor = listed.cursor;
  }
  reviews.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return reviews;
}

async function sendOwner(env, payload, replyTo) {
  const from = stripHeader(env.RESEND_FROM || "Emotion Rides <drops@updates.emotionrides.com>");
  const owner = stripHeader(env.RESEND_OWNER || OWNER_DEFAULT);
  const body = {
    from,
    to: [owner],
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  };
  if (replyTo) body.reply_to = replyTo;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "emotionrides-reviews/1.0",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(JSON.stringify({ event: "review_email_failed", status: res.status }));
  }
  return res.ok;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request),
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isConfigured(env)) return json(request, 200, emptyList());
  try {
    const all = await listApproved(env.REVIEWS);
    const reviews = all.slice(0, 40);
    return json(
      request,
      200,
      {
        configured: true,
        reviews,
        count: all.length,
        average: averageRating(all),
      },
      { "Cache-Control": "public, max-age=15" },
    );
  } catch (err) {
    console.error(JSON.stringify({ event: "review_list_failed", message: String(err && err.message ? err.message : err) }));
    return json(request, 200, { configured: true, reviews: [], count: 0, average: null });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isConfigured(env)) {
    return json(request, 503, { error: "Reviews aren’t open yet." });
  }

  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return json(request, 400, { error: "Bad request." });
  }
  if (raw.length > 8000) return json(request, 413, { error: "That review is too long." });

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(request, 400, { error: "Bad request." });
  }

  const parsed = parseReview(payload);
  if (!parsed.ok) return json(request, 400, { error: parsed.error });
  if (parsed.honeypot) return json(request, 200, { ok: true });

  const kv = env.REVIEWS;
  const ip = clientIp(request);
  const rlKey = "rl:" + (await clientKey(ip));
  let used = 0;
  try {
    used = parseInt((await kv.get(rlKey)) || "0", 10);
    if (!Number.isFinite(used) || used < 0) used = 0;
  } catch (err) {
    console.error(JSON.stringify({ event: "review_rate_read_failed", message: String(err && err.message ? err.message : err) }));
    return json(request, 503, { error: "Reviews aren’t open yet." });
  }
  if (used >= RATE_LIMIT) {
    return json(request, 429, { error: "Easy — try again in a bit." });
  }

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const review = {
    id,
    name: parsed.value.name,
    rating: parsed.value.rating,
    product: parsed.value.product,
    text: parsed.value.text,
    email: parsed.value.email,
    status: "pending",
    createdAt,
  };

  try {
    await kv.put(rlKey, String(used + 1), { expirationTtl: RATE_WINDOW_SEC });
    await kv.put("review:" + id, JSON.stringify(review));
  } catch (err) {
    console.error(JSON.stringify({ event: "review_save_failed", message: String(err && err.message ? err.message : err) }));
    return json(request, 503, { error: "Couldn’t send that. Try again." });
  }

  const exp = Date.now() + TOKEN_TTL_MS;
  const approveToken = await signToken(env.REVIEW_SIGNING_SECRET, { id, action: "approve", exp });
  const deleteToken = await signToken(env.REVIEW_SIGNING_SECRET, { id, action: "delete", exp });
  const origin = publicOrigin(request);
  const approveUrl = origin + "/api/review-moderate?token=" + encodeURIComponent(approveToken);
  const deleteUrl = origin + "/api/review-moderate?token=" + encodeURIComponent(deleteToken);
  const mail = ownerEmail({
    review,
    approveUrl,
    deleteUrl,
    when: denverStamp(),
  });

  let mailed = false;
  try {
    mailed = await sendOwner(env, mail, review.email || "");
  } catch (err) {
    console.error(JSON.stringify({ event: "review_email_failed", message: String(err && err.message ? err.message : err) }));
    mailed = false;
  }

  if (!mailed) {
    try {
      await kv.delete("review:" + id);
    } catch {
      /* owner can still delete from KV if the email actually landed */
    }
    return json(request, 502, { error: "Couldn’t send that. Try again." });
  }

  console.log(JSON.stringify({
    event: "review_submitted",
    id,
    rating: review.rating,
    product: review.product || null,
  }));

  return json(request, 200, { ok: true });
}

function publicOrigin(request) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return url.origin;
  if (
    host === "emotionrides.com" ||
    host === "www.emotionrides.com" ||
    host.endsWith(".pages.dev")
  ) {
    return "https://" + host;
  }
  return "https://emotionrides.com";
}
