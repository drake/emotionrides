/**
 * Emotion Rides drop-list signup
 * Cloudflare Pages Function → Resend Contacts + notify owner + welcome email
 *
 * Secrets (Pages project "emotionrides"):
 *   RESEND_API_KEY
 * Optional:
 *   RESEND_FROM=Emotion Rides <drops@updates.emotionrides.com>
 *   RESEND_OWNER=sbackemoto@gmail.com
 *   RESEND_AUDIENCE_ID  (if using Audiences API path)
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

  // honeypot
  if (payload.company) return json(request, 200, { ok: true });

  const email = String(payload.email || "").trim().toLowerCase();
  if (!validEmail(email)) {
    return json(request, 400, { error: "That email doesn’t look right." });
  }

  const audienceId = env.RESEND_AUDIENCE_ID || "db0a0022-4857-413f-9517-e9128bf1f088";
  const contactPath = audienceId
    ? `/audiences/${audienceId}/contacts`
    : "/contacts";
  const contact = await resend(apiKey, contactPath, {
    email,
    unsubscribed: false,
  });

  const contactOk = contact.ok || contact.status === 409;
  if (!contactOk) {
    console.error("contact", contact.status);
    return json(request, 502, { error: "Couldn’t join. Try again." });
  }

  // Welcome email (best-effort)
  await resend(apiKey, "/emails", {
    from,
    to: [email],
    subject: "You’re on the Emotion Rides drop list",
    html: `<div style="font-family:Georgia,serif;background:#0a0a0a;color:#e8e4dc;padding:32px">
      <p style="letter-spacing:.3em;text-transform:uppercase;color:#c6a15b;font-size:12px">Emotion Rides</p>
      <h1 style="font-size:28px;line-height:1.1">You’re on the list.</h1>
      <p>When the limited drop goes live, you’ll hear first. Rare codes only — no spam.</p>
      <p style="margin-top:24px"><a href="https://shop.emotionrides.com" style="color:#c6a15b">shop.emotionrides.com</a>
      · <a href="https://www.youtube.com/@SBackEMoto/shorts" style="color:#c6a15b">Shorts</a></p>
      <p style="color:#8a8680;font-size:12px;margin-top:32px">Ride Electric. Wear Authentic.</p>
    </div>`,
    text: "You're on the Emotion Rides drop list. We'll email when the limited drop goes live.",
  });

  // Notify owner (best-effort)
  await resend(apiKey, "/emails", {
    from,
    to: [owner],
    subject: `Drop list signup: ${email}`,
    text: `New Emotion Rides drop-list signup.\n\nEmail: ${email}\nTime: ${new Date().toISOString()}\n`,
  });

  return json(request, 200, { ok: true });
}
