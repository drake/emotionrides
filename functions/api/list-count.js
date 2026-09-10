/**
 * Public drop-list subscriber count (subscribed contacts only).
 * GET /api/list-count → { count, updatedAt }
 *
 * Secrets: RESEND_API_KEY, optional RESEND_AUDIENCE_ID
 */

const ALLOWED = new Set([
  "https://emotionrides.com",
  "https://www.emotionrides.com",
  "https://shop.emotionrides.com",
  "https://emotionrides.bigcartel.com",
]);

function corsHeaders(request) {
  const origin = (request && request.headers && request.headers.get("Origin")) || "";
  const allow = ALLOWED.has(origin) ? origin : "https://emotionrides.com";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
    "Cache-Control": "public, max-age=30, s-maxage=30",
  };
}

function json(request, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

async function countSubscribers(apiKey, audienceId) {
  let after = null;
  let count = 0;
  for (let i = 0; i < 50; i++) {
    let url = `https://api.resend.com/audiences/${audienceId}/contacts?limit=100`;
    if (after) url += `&after=${encodeURIComponent(after)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "emotionrides-signup/1.0",
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`resend ${res.status}`);
    const rows = data.data || [];
    count += rows.filter((c) => !c.unsubscribed).length;
    if (!data.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return count;
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(context.request),
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return json(request, 500, { error: "Not configured." });
  const audienceId =
    env.RESEND_AUDIENCE_ID || "db0a0022-4857-413f-9517-e9128bf1f088";
  try {
    const count = await countSubscribers(apiKey, audienceId);
    return json(request, 200, {
      count,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("list-count", String(e && e.message ? e.message : e));
    return json(request, 502, { error: "Couldn’t load count." });
  }
}
