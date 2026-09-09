/**
 * Emotion Rides drop-list signup
 * Cloudflare Pages Function → Resend Contacts + notify owner + welcome email
 *
 * Secrets (Pages project "emotionrides"):
 *   RESEND_API_KEY
 * Optional:
 *   RESEND_FROM=Emotion Rides <drops@updates.emotionrides.com>
 *   RESEND_OWNER=sbackemoto@gmail.com
 *   RESEND_AUDIENCE_ID
 */

const ALLOWED = new Set([
  "https://emotionrides.com",
  "https://www.emotionrides.com",
]);

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get("Origin")) || "";
  const allow = ALLOWED.has(origin) ? origin : "https://emotionrides.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length < 200;
}

function denverStamp(d = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d) + " MT";
  } catch {
    return d.toISOString();
  }
}

async function resend(apiKey, path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "emotionrides-signup/1.0",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function welcomeHtml() {
  return `<div style="font-family:Georgia,serif;background:#0a0a0a;color:#e8e4dc;padding:32px;max-width:560px;margin:0 auto">
  <p style="letter-spacing:.3em;text-transform:uppercase;color:#c6a15b;font-size:12px;margin:0 0 16px">Emotion Rides</p>
  <h1 style="font-size:30px;line-height:1.15;margin:0 0 16px;color:#fff">You’re on the list.</h1>
  <p style="font-size:17px;line-height:1.5;margin:0 0 16px">Ride Electric. Wear Authentic. This list is how you hear first — before the feed — when the limited drop goes live.</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 8px;color:#c6a15b">What you’ll get</p>
  <ul style="font-size:15px;line-height:1.6;margin:0 0 20px;padding-left:1.2em;color:#e8e4dc">
    <li>Launch alert when the drop opens</li>
    <li>Rare list-only codes (not weekly spam)</li>
    <li>Occasional early looks at pieces / stock</li>
  </ul>
  <p style="font-size:15px;line-height:1.55;margin:0 0 24px">Shop’s locked until the clothes land and photos are ready. Meanwhile the rides keep rolling on Shorts.</p>
  <p style="margin:0 0 8px">
    <a href="https://shop.emotionrides.com" style="color:#c6a15b">shop.emotionrides.com</a>
    &nbsp;·&nbsp;
    <a href="https://www.youtube.com/@SBackEMoto/shorts" style="color:#c6a15b">@SBackEMoto Shorts</a>
    &nbsp;·&nbsp;
    <a href="https://emotionrides.com" style="color:#c6a15b">emotionrides.com</a>
  </p>
  <p style="color:#8a8680;font-size:12px;margin:28px 0 0;line-height:1.5">Unsubscribe anytime by replying or emailing sbackemoto@gmail.com. We don’t sell your email. Ever.</p>
</div>`;
}

function welcomeText() {
  return `You’re on the Emotion Rides drop list.

Ride Electric. Wear Authentic.

You’ll hear first when the limited drop goes live — plus rare list-only codes. No spam.

Shop: https://shop.emotionrides.com
Shorts: https://www.youtube.com/@SBackEMoto/shorts
Site: https://emotionrides.com

Shop stays closed until stock + photos. Reply to get off the list anytime.`;
}

function ownerHtml({ email, when, isNew, referer, ip }) {
  const status = isNew ? "New contact" : "Already on the list (re-submit)";
  return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;background:#111;color:#eee;padding:24px;max-width:560px">
  <p style="letter-spacing:.2em;text-transform:uppercase;color:#c6a15b;font-size:11px;margin:0 0 12px">Emotion Rides · Drop list</p>
  <h1 style="font-size:22px;margin:0 0 12px;color:#fff">Someone joined the drop list</h1>
  <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5">
    <tr><td style="padding:6px 0;color:#8a8680;width:120px">Email</td><td style="padding:6px 0"><a href="mailto:${email}" style="color:#5ef0ff">${email}</a></td></tr>
    <tr><td style="padding:6px 0;color:#8a8680">When</td><td style="padding:6px 0">${when}</td></tr>
    <tr><td style="padding:6px 0;color:#8a8680">Status</td><td style="padding:6px 0">${status}</td></tr>
    <tr><td style="padding:6px 0;color:#8a8680">Source</td><td style="padding:6px 0">emotionrides.com/#drop-list</td></tr>
    ${referer ? `<tr><td style="padding:6px 0;color:#8a8680">Referer</td><td style="padding:6px 0;word-break:break-all">${referer}</td></tr>` : ""}
    ${ip ? `<tr><td style="padding:6px 0;color:#8a8680">IP</td><td style="padding:6px 0">${ip}</td></tr>` : ""}
  </table>
  <p style="margin:20px 0 0;font-size:14px;line-height:1.5">
    <a href="https://resend.com/audiences" style="color:#c6a15b">Open Resend audience</a>
    &nbsp;·&nbsp;
    <a href="https://emotionrides.com/#drop-list" style="color:#c6a15b">Site form</a>
    &nbsp;·&nbsp;
    <a href="https://shop.emotionrides.com" style="color:#c6a15b">Shop (closed)</a>
  </p>
  <p style="color:#8a8680;font-size:12px;margin:16px 0 0">Welcome email was sent to them automatically.</p>
</div>`;
}

function ownerText({ email, when, isNew, referer, ip }) {
  return `Someone joined the Emotion Rides drop list

Email: ${email}
When: ${when}
Status: ${isNew ? "New contact" : "Already on the list (re-submit)"}
Source: emotionrides.com/#drop-list
${referer ? `Referer: ${referer}\n` : ""}${ip ? `IP: ${ip}\n` : ""}
Resend: https://resend.com/audiences
Site: https://emotionrides.com/#drop-list

Welcome email sent to them automatically.`;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return json(request, 500, { error: "List not configured yet." });

  const from =
    env.RESEND_FROM || "Emotion Rides <drops@updates.emotionrides.com>";
  const owner = env.RESEND_OWNER || "sbackemoto@gmail.com";

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(request, 400, { error: "Bad request." });
  }

  if (payload.company) return json(request, 200, { ok: true });

  const email = String(payload.email || "").trim().toLowerCase();
  if (!validEmail(email)) {
    return json(request, 400, { error: "That email doesn’t look right." });
  }

  const audienceId =
    env.RESEND_AUDIENCE_ID || "db0a0022-4857-413f-9517-e9128bf1f088";
  const contactPath = audienceId
    ? `/audiences/${audienceId}/contacts`
    : "/contacts";
  const contact = await resend(apiKey, contactPath, {
    email,
    unsubscribed: false,
  });

  const isNew = contact.ok;
  const contactOk = contact.ok || contact.status === 409;
  if (!contactOk) {
    console.error("contact", contact.status);
    return json(request, 502, { error: "Couldn’t join. Try again." });
  }

  const when = denverStamp();
  const referer = request.headers.get("Referer") || "";
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "";

  // Welcome to subscriber (best-effort) — always send so they get the full brand email
  await resend(apiKey, "/emails", {
    from,
    to: [email],
    subject: "You’re on the Emotion Rides drop list — here’s what’s next",
    html: welcomeHtml(),
    text: welcomeText(),
  });

  // Richer owner ping
  await resend(apiKey, "/emails", {
    from,
    to: [owner],
    reply_to: email,
    subject: `Drop list · ${isNew ? "new" : "again"} · ${email}`,
    html: ownerHtml({ email, when, isNew, referer, ip }),
    text: ownerText({ email, when, isNew, referer, ip }),
  });

  return json(request, 200, { ok: true });
}
