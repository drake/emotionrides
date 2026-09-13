/**
 * Password gate for shop.emotionrides.com (Big Cartel behind Cloudflare).
 * Same SITE_PASSWORD + er_gate cookie as emotionrides.com (Domain=.emotionrides.com).
 */

const COOKIE = "er_gate";

async function tokenFor(password) {
  const data = new TextEncoder().encode("emotionrides-gate:" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export default {
  async fetch(request, env) {
    const password = env.SITE_PASSWORD || "";
    if (!password) {
      return new Response("Shop password not configured.", { status: 503 });
    }

    const expected = await tokenFor(password);
    const cookies = parseCookie(request.headers.get("Cookie") || "");
    if (cookies[COOKIE] === expected) {
      // Pass through to Big Cartel origin for this hostname
      return fetch(request);
    }

    const next = "https://shop.emotionrides.com" + new URL(request.url).pathname + new URL(request.url).search;
    const login = "https://emotionrides.com/?next=" + encodeURIComponent(next);
    return Response.redirect(login, 302);
  },
};
