/**
 * Password unlock — sets er_gate cookie (shared on *.emotionrides.com) and redirects.
 * Secret: SITE_PASSWORD
 * Optional form field or query: next=https://shop.emotionrides.com/
 */

async function tokenFor(password) {
  const data = new TextEncoder().encode("emotionrides-gate-v5:" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeNext(raw) {
  try {
    const n = new URL(String(raw || ""), "https://emotionrides.com");
    if (
      n.hostname === "emotionrides.com" ||
      n.hostname === "www.emotionrides.com" ||
      n.hostname === "shop.emotionrides.com"
    ) {
      return n.href;
    }
  } catch (_) {}
  return "https://emotionrides.com/";
}

function gatePage(wrong, next) {
  const msg = wrong
    ? `<p class="err">Wrong password.</p>`
    : `<p class="sub">This site is locked. Enter the password to continue.</p>`;
  const nextVal = String(next || "https://emotionrides.com/").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Locked — Emotion Rides</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
html { height: 100%; }
body {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-items: center;
  padding:
    max(1rem, env(safe-area-inset-top, 0px))
    max(1rem, env(safe-area-inset-right, 0px))
    max(1rem, env(safe-area-inset-bottom, 0px))
    max(1rem, env(safe-area-inset-left, 0px));
  font-family: Archivo, Helvetica, Arial, sans-serif;
  background: #050505;
  color: #e8e4dc;
}
.card {
  width: min(100%, 380px);
  margin: 0 auto;
  padding: 1.6rem 1.25rem;
  background: #0a0a0a;
  border: 1px solid rgba(198,161,91,.45);
}
.lock {
  display: inline-block;
  margin: 0 0 .75rem;
  padding: .35rem .65rem;
  border: 1px solid rgba(198,161,91,.55);
  color: #c6a15b;
  font: 700 .72rem Bebas Neue, Oswald, sans-serif;
  letter-spacing: .22em;
  text-transform: uppercase;
}
h1 {
  margin: 0 0 .35rem; font-family: "Bebas Neue", Oswald, sans-serif;
  letter-spacing: .12em; font-size: clamp(1.35rem, 5.5vw, 1.6rem); font-weight: 700;
  text-transform: uppercase; color: #f4f1ea;
}
.sub { margin: 0 0 1.1rem; color: #8a8680; font-size: .92rem; line-height: 1.4; }
.err { margin: 0 0 1.1rem; color: #ff6b6b; font-size: .92rem; }
label { display: block; font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; color: #c6a15b; margin-bottom: .45rem; }
input[type=password] {
  width: 100%; padding: .9rem .9rem; border: 1px solid rgba(198,161,91,.35);
  background: #050505; color: #f4f1ea; font-size: 16px; outline: none;
  border-radius: 0; -webkit-appearance: none; appearance: none;
}
input[type=password]:focus { border-color: #c6a15b; }
button {
  margin-top: .9rem; width: 100%; min-height: 48px; padding: .95rem;
  border: 0; background: #c6a15b; color: #0a0a0a;
  font-family: "Bebas Neue", Oswald, sans-serif; letter-spacing: .16em;
  text-transform: uppercase; font-size: 1.05rem; font-weight: 700; cursor: pointer;
  border-radius: 0; -webkit-appearance: none; appearance: none;
}
@media (max-width: 430px) {
  .card { padding: 1.35rem 1.1rem; }
  .sub, .err { font-size: .88rem; }
}
</style>
</head>
<body>
  <form class="card" method="post" action="https://emotionrides.com/api/gate">
    <div class="lock">Site locked</div>
    <h1>Emotion Rides</h1>
    ${msg}
    <input type="hidden" name="next" value="${nextVal}"/>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="text" autofocus required/>
    <button type="submit">Unlock</button>
  </form>
</body>
</html>`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const password = String((env && env.SITE_PASSWORD) || "").trim();
  const alt = String((env && env.SITE_PASSWORD_ALT) || "").trim();
  if (!password) {
    return new Response("Site password not configured.", { status: 503 });
  }

  let provided = "";
  let next = "https://emotionrides.com/";
  try {
    const form = await request.formData();
    provided = String(form.get("password") || "").trim();
    next = safeNext(form.get("next"));
  } catch (_) {
    provided = "";
  }

  if (provided === password || (alt && provided === alt)) {
    const expected = await tokenFor(password);
    const cookieDomain =
      "er_gate=" + expected + "; Path=/; Domain=.emotionrides.com; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000";
    const cookieHost =
      "er_gate=" + expected + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000";
    const esc = next
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const html = [
      "<!doctype html><html lang=\"en\"><head>",
      "<meta charset=\"utf-8\"/>",
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>",
      "<meta http-equiv=\"refresh\" content=\"0;url=" + esc + "\"/>",
      "<title>Unlocking…</title>",
      "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050505;color:#c6a15b;font:16px Archivo,Helvetica,sans-serif}</style>",
      "</head><body><p>Unlocking…</p>",
      "<script>location.replace(" + JSON.stringify(next) + ");</script>",
      "<p><a href=\"" + esc + "\" style=\"color:#c6a15b\">Continue</a></p>",
      "</body></html>",
    ].join("");
    const headers = new Headers();
    headers.append("Content-Type", "text/html; charset=utf-8");
    headers.append("Cache-Control", "no-store");
    headers.append("Set-Cookie", cookieDomain);
    headers.append("Set-Cookie", cookieHost);
    return new Response(html, { status: 200, headers });
  }

  return new Response(gatePage(true, next), {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const next = safeNext(url.searchParams.get("next"));
  return new Response(null, { status: 303, headers: { Location: "/?next=" + encodeURIComponent(next) } });
}
