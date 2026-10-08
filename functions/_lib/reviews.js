/**
 * Shared review validation, signing, and HTML escaping.
 * Binding: REVIEWS (KV). Secret: REVIEW_SIGNING_SECRET.
 * Also uses existing RESEND_API_KEY / RESEND_FROM / RESEND_OWNER.
 */

export const PRODUCTS = ["Hoodie", "Tee", "Jeans", "Jorts"];
export const TEXT_MIN = 4;
export const TEXT_MAX = 600;
export const NAME_MAX = 40;
export const RATE_LIMIT = 5;
export const RATE_WINDOW_SEC = 60 * 60;
export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const OWNER_DEFAULT = "sbackemoto@gmail.com";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeWithBreaks(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

export function isConfigured(env) {
  const kv = env && env.REVIEWS;
  return !!(
    kv &&
    typeof kv.get === "function" &&
    typeof kv.put === "function" &&
    typeof kv.delete === "function" &&
    typeof kv.list === "function" &&
    env.REVIEW_SIGNING_SECRET &&
    env.RESEND_API_KEY
  );
}

export function validEmail(email) {
  return EMAIL_RE.test(email) && email.length < 200;
}

function cleanName(raw) {
  return String(raw ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBody(raw) {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseReview(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Bad request." };
  }
  if (input.fax_number) return { ok: true, honeypot: true };

  if (typeof input.rating !== "number" && typeof input.rating !== "string") {
    return { ok: false, error: "Pick a star rating." };
  }
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Pick a star rating." };
  }

  const name = cleanName(input.name);
  if (!name) return { ok: false, error: "Add a first name or nickname." };
  if (name.length > NAME_MAX) return { ok: false, error: "That name is too long." };
  if (name.includes("@") || /https?:\/\/|www\./i.test(name) || /[<>]/.test(name)) {
    return { ok: false, error: "Use a first name or nickname, not an email." };
  }
  if (!/[0-9A-Za-z]/.test(name) && !/[^\x00-\x7F]/.test(name)) {
    return { ok: false, error: "Use a first name or nickname." };
  }

  const rawProduct = String(input.product ?? "").trim();
  let product = "";
  if (rawProduct) {
    const match = PRODUCTS.find((p) => p.toLowerCase() === rawProduct.toLowerCase());
    if (!match) {
      return { ok: false, error: "Pick a product from the list, or leave it blank." };
    }
    product = match;
  }

  const text = cleanBody(input.text);
  if (text.length < TEXT_MIN || text.length > TEXT_MAX) {
    return { ok: false, error: "Write a few words (4–600 characters)." };
  }
  const links = text.match(/https?:\/\/|www\./gi);
  if (links && links.length > 2) {
    return { ok: false, error: "Keep links out of the review." };
  }

  const email = String(input.email ?? "").trim().toLowerCase();
  if (email && !validEmail(email)) {
    return { ok: false, error: "That email doesn’t look right." };
  }

  return {
    ok: true,
    value: { rating, name, product, text, email },
  };
}

export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

export function denverStamp(d = new Date()) {
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Denver",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d) + " MT"
    );
  } catch {
    return d.toISOString();
  }
}

/** Public shape. Never includes email. */
export function toPublic(record) {
  if (!record || typeof record !== "object") return null;
  const rating = Number(record.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const name = cleanName(record.name);
  if (!name || name.length > NAME_MAX) return null;
  const text = cleanBody(record.text);
  if (!text || text.length > TEXT_MAX) return null;
  const product = PRODUCTS.includes(record.product) ? record.product : "";
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  if (!createdAt) return null;
  return {
    name,
    rating,
    product,
    text,
    createdAt,
    dateLabel: formatDate(createdAt),
  };
}

export function averageRating(reviews) {
  if (!reviews.length) return null;
  const sum = reviews.reduce((total, review) => total + review.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

export function clientIp(request) {
  const cf = request.headers.get("CF-Connecting-IP");
  if (cf) return cf.trim();
  const xff = request.headers.get("X-Forwarded-For");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export async function clientKey(ip) {
  const data = new TextEncoder().encode("emotionrides-review-rl:" + (ip || "unknown"));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input) {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToBase64Url(sig);
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function signToken(secret, payload) {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(secret, body);
  return body + "." + sig;
}

export async function verifyToken(secret, token) {
  if (!secret || typeof token !== "string" || token.length < 20 || token.length > 2000) {
    return null;
  }
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected;
  try {
    expected = await hmac(secret, body);
  } catch {
    return null;
  }
  if (!safeEqual(expected, sig)) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
  } catch {
    return null;
  }
  if (!payload || (payload.action !== "approve" && payload.action !== "delete")) return null;
  if (typeof payload.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.id)) {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
  return { id: payload.id, action: payload.action, exp: payload.exp };
}

export function stripHeader(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

const DONE_COPY = {
  approved: "Approved. It’s on the site.",
  deleted: "Deleted. It won’t show on the site.",
  already: "Already approved.",
  gone: "That review is already gone.",
};

export function doneCopy(code) {
  return DONE_COPY[code] || "";
}

export function moderationPage({ mode, review, token, action }) {
  const title =
    mode === "confirm"
      ? action === "delete"
        ? "Delete this review?"
        : "Approve this review?"
      : mode === "invalid"
        ? "Link not valid"
        : "Review updated";
  const message =
    mode === "confirm"
      ? action === "delete"
        ? "This removes it. It will not show on the site."
        : "This publishes it on emotionrides.com."
      : mode === "invalid"
        ? "This link expired or isn’t valid."
        : doneCopy(mode) || "Done.";

  const preview = review
    ? `<div class="card">
        <p class="stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>
        <p class="who">${escapeHtml(review.name)}${review.product ? ` · ${escapeHtml(review.product)}` : ""}</p>
        <p class="text">${escapeWithBreaks(review.text)}</p>
        <p class="date">${escapeHtml(review.dateLabel || "")}</p>
      </div>`
    : "";

  const form =
    mode === "confirm"
      ? `<form method="post" action="/api/review-moderate">
          <input type="hidden" name="token" value="${escapeHtml(token)}">
          <button type="submit" class="${action === "delete" ? "danger" : "go"}">${action === "delete" ? "Delete" : "Approve"}</button>
        </form>`
      : `<p class="back"><a href="https://emotionrides.com/#reviews">Back to the site</a></p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)} — Emotion Rides</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; padding: 1.5rem 1rem 2.5rem;
    font-family: Archivo, "Helvetica Neue", Arial, sans-serif;
    background: #050505; color: #f4f1ea;
  }
  main { width: min(100%, 440px); margin: 0 auto; }
  p.kicker {
    letter-spacing: .22em; text-transform: uppercase; color: #c6a15b;
    font-size: .72rem; font-weight: 700; margin: 0 0 .6rem;
  }
  h1 {
    font-family: "Bebas Neue", "Arial Narrow", Impact, sans-serif;
    font-weight: 400; letter-spacing: .06em; text-transform: uppercase;
    font-size: 2.6rem; line-height: .9; margin: 0 0 .7rem;
  }
  .lead { color: #9a9488; margin: 0 0 1.2rem; line-height: 1.45; }
  .card {
    border: 1px solid rgba(255,255,255,.12);
    border-top: 2px solid #5ef0ff;
    padding: 1rem 1rem 1.05rem; margin-bottom: 1.1rem;
    background: #0c0c0c;
  }
  .stars { margin: 0 0 .35rem; color: #5ef0ff; letter-spacing: .12em; font-size: 1.15rem; }
  .who { margin: 0; font-family: "Bebas Neue", Impact, sans-serif; letter-spacing: .08em; text-transform: uppercase; font-size: 1.35rem; }
  .text { margin: .55rem 0 0; color: #f4f1ea; line-height: 1.45; overflow-wrap: anywhere; }
  .date { margin: .7rem 0 0; color: #9a9488; font-size: .78rem; letter-spacing: .08em; text-transform: uppercase; }
  button, .back a {
    display: block; width: 100%; text-align: center; text-decoration: none;
    min-height: 52px; line-height: 52px; padding: 0 1rem;
    font-family: "Bebas Neue", Impact, sans-serif; letter-spacing: .16em;
    text-transform: uppercase; font-size: 1.25rem; border: 0; cursor: pointer;
  }
  button.go { background: #c6a15b; color: #0a0a0a; }
  button.danger { background: transparent; color: #ff8d8d; border: 1px solid #ff6b6b; }
  .back { margin: 0; }
  .back a { background: #c6a15b; color: #0a0a0a; }
</style>
</head>
<body>
<main>
  <p class="kicker">Emotion Rides</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lead">${escapeHtml(message)}</p>
  ${preview}
  ${form}
</main>
</body>
</html>`;
}

export function ownerEmail({ review, approveUrl, deleteUrl, when }) {
  const product = review.product || "—";
  const subject = stripHeader(
    `Review pending · ${review.name} · ${review.rating} star${review.rating === 1 ? "" : "s"}`,
  );
  const emailRow = review.email
    ? `<tr><td style="padding:6px 0;color:#8a8680;width:90px">Email</td><td style="padding:6px 0"><a href="mailto:${escapeHtml(review.email)}" style="color:#5ef0ff">${escapeHtml(review.email)}</a></td></tr>`
    : `<tr><td style="padding:6px 0;color:#8a8680">Email</td><td style="padding:6px 0">Not given</td></tr>`;
  const html = `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#111;color:#eee;padding:24px;max-width:560px">
  <p style="letter-spacing:.2em;text-transform:uppercase;color:#c6a15b;font-size:11px;margin:0 0 12px">Emotion Rides · Review</p>
  <h1 style="font-size:22px;margin:0 0 12px;color:#fff">New review waiting</h1>
  <p style="margin:0 0 14px;color:#5ef0ff;letter-spacing:.08em">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
    <tr><td style="padding:6px 0;color:#8a8680;width:90px">Name</td><td style="padding:6px 0">${escapeHtml(review.name)}</td></tr>
    <tr><td style="padding:6px 0;color:#8a8680">Product</td><td style="padding:6px 0">${escapeHtml(product)}</td></tr>
    <tr><td style="padding:6px 0;color:#8a8680">When</td><td style="padding:6px 0">${escapeHtml(when)}</td></tr>
    ${emailRow}
  </table>
  <p style="font-size:15px;line-height:1.5;margin:16px 0;white-space:pre-wrap">${escapeWithBreaks(review.text)}</p>
  <p style="margin:0 0 14px;color:#8a8680;font-size:13px;line-height:1.45">Each link opens a confirm page, so a mail app can’t approve or delete it by prefetching the URL. Email is never shown on the site.</p>
  <table role="presentation" width="100%" style="border-collapse:collapse">
    <tr><td style="padding:0 0 10px">
      <a href="${escapeHtml(approveUrl)}" style="display:block;text-align:center;background:#c6a15b;color:#111;padding:16px 12px;text-decoration:none;font-weight:700;letter-spacing:.14em;text-transform:uppercase">Approve</a>
    </td></tr>
    <tr><td>
      <a href="${escapeHtml(deleteUrl)}" style="display:block;text-align:center;border:1px solid #ff6b6b;color:#ff8d8d;padding:16px 12px;text-decoration:none;font-weight:700;letter-spacing:.14em;text-transform:uppercase">Delete</a>
    </td></tr>
  </table>
</div>`;
  const text = `New Emotion Rides review waiting

${review.rating}/5  ${review.name}${review.product ? " · " + review.product : ""}
When: ${when}
Email: ${review.email || "Not given"}

${review.text}

Approve (opens a confirm page):
${approveUrl}

Delete (opens a confirm page):
${deleteUrl}

The email is never shown on the site.`;
  return { subject, html, text };
}
