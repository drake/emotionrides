/**
 * Owner moderation. Signed links from the review email.
 * GET  shows a confirm page (no change — mail apps prefetch GET).
 * POST performs Approve or Delete.
 *
 * Secret: REVIEW_SIGNING_SECRET
 * Binding: REVIEWS (KV)
 */

import {
  doneCopy,
  isConfigured,
  moderationPage,
  toPublic,
  verifyToken,
} from "../_lib/reviews.js";

const SECURITY = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function html(status, markup) {
  return new Response(markup, { status, headers: SECURITY });
}

async function readToken(request) {
  if (request.method === "GET") {
    return new URL(request.url).searchParams.get("token") || "";
  }
  try {
    const form = await request.formData();
    return String(form.get("token") || "");
  } catch {
    return "";
  }
}

async function loadReview(kv, id) {
  const pending = await kv.get("review:" + id, "json");
  if (pending) return pending;
  const approved = await kv.get("approved:" + id, "json");
  if (!approved) return null;
  return { ...approved, id, status: "approved", email: "" };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!token) {
    const done = url.searchParams.get("done") || "";
    if (doneCopy(done)) return html(200, moderationPage({ mode: done, review: null, token: "", action: "" }));
    return html(400, moderationPage({ mode: "invalid", review: null, token: "", action: "" }));
  }
  if (!isConfigured(env)) {
    return html(503, moderationPage({ mode: "invalid", review: null, token: "", action: "" }));
  }
  const payload = await verifyToken(env.REVIEW_SIGNING_SECRET, token);
  if (!payload) return html(400, moderationPage({ mode: "invalid", review: null, token: "", action: "" }));

  let record = null;
  try {
    record = await loadReview(env.REVIEWS, payload.id);
  } catch (err) {
    console.error(JSON.stringify({ event: "review_moderate_read_failed", message: String(err && err.message ? err.message : err) }));
    return html(503, moderationPage({ mode: "invalid", review: null, token: "", action: "" }));
  }
  const pub = record ? toPublic(record) : null;
  if (!record || !pub) return html(200, moderationPage({ mode: "gone", review: null, token: "", action: "" }));
  if (payload.action === "approve" && record.status === "approved") {
    return html(200, moderationPage({ mode: "already", review: pub, token: "", action: "" }));
  }
  return html(200, moderationPage({
    mode: "confirm",
    review: pub,
    token,
    action: payload.action,
  }));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isConfigured(env)) {
    return html(503, moderationPage({ mode: "invalid", review: null, token: "", action: "" }));
  }
  const token = await readToken(request);
  const payload = await verifyToken(env.REVIEW_SIGNING_SECRET, token);
  if (!payload) return html(400, moderationPage({ mode: "invalid", review: null, token: "", action: "" }));

  const kv = env.REVIEWS;
  let outcome = "gone";
  try {
    const record = await kv.get("review:" + payload.id, "json");
    const approved = await kv.get("approved:" + payload.id, "json");
    if (payload.action === "delete") {
      if (!record && !approved) {
        outcome = "gone";
      } else {
        await kv.delete("review:" + payload.id);
        await kv.delete("approved:" + payload.id);
        outcome = "deleted";
      }
    } else if (!record && approved) {
      outcome = "already";
    } else if (!record) {
      outcome = "gone";
    } else if (record.status === "approved") {
      outcome = "already";
    } else {
      const next = {
        ...record,
        status: "approved",
        approvedAt: new Date().toISOString(),
      };
      const pub = toPublic(next);
      if (!pub) {
        outcome = "gone";
      } else {
        await kv.put("review:" + payload.id, JSON.stringify(next));
        await kv.put("approved:" + payload.id, JSON.stringify(pub));
        outcome = "approved";
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ event: "review_moderate_failed", message: String(err && err.message ? err.message : err) }));
    return html(503, moderationPage({ mode: "invalid", review: null, token: "", action: "" }));
  }

  console.log(JSON.stringify({ event: "review_moderated", id: payload.id, action: payload.action, outcome }));
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/api/review-moderate?done=" + outcome,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
