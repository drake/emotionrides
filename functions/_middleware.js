/**
 * Emotion Rides site password gate.
 * Set Pages secret: SITE_PASSWORD
 * Exempts /api/list-count so the closed Big Cartel page can still show drop-list count.
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

function gatePage(wrong) {
  const msg = wrong
    ? `<p class="err">Wrong password.</p>`
    : `<p class="sub">Private drop — enter the password.</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Emotion Rides</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: Archivo, Helvetica, Arial, sans-serif;
    background: #050505; color: #e8e4dc;
    background-image:
      linear-gradient(180deg, rgba(5,5,5,.45), rgba(5,5,5,.92)),
      url("/emotion-bg-new.png");
    background-size: cover; background-position: center;
  }
  .card {
    width: min(92vw, 380px); padding: 2rem 1.4rem;
    background: rgba(8,8,8,.78); border: 1px solid rgba(198,161,91,.28);
    backdrop-filter: blur(8px);
  }
  h1 {
    margin: 0 0 .35rem; font-family: "Bebas Neue", Oswald, sans-serif;
    letter-spacing: .14em; font-size: 1.6rem; font-weight: 700;
    text-transform: uppercase; color: #f4f1ea;
  }
  .sub { margin: 0 0 1.1rem; color: #8a8680; font-size: .92rem; }
  .err { margin: 0 0 1.1rem; color: #ff6b6b; font-size: .92rem; }
  label { display: block; font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; color: #c6a15b; margin-bottom: .45rem; }
  input[type=password] {
    width: 100%; padding: .85rem .9rem; border: 1px solid rgba(198,161,91,.35);
    background: #0a0a0a; color: #f4f1ea; font-size: 1rem; outline: none;
  }
  input[type=password]:focus { border-color: #c6a15b; }
  button {
    margin-top: .9rem; width: 100%; padding: .9rem;
    border: 0; background: #c6a15b; color: #0a0a0a;
    font-family: "Bebas Neue", Oswald, sans-serif; letter-spacing: .18em;
    text-transform: uppercase; font-size: 1rem; font-weight: 700; cursor: pointer;
  }
  button:hover { filter: brightness(1.05); }
</style>
</head>
<body>
  <form class="card" method="post" action="/">
    <h1>Emotion Rides</h1>
    ${msg}
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" autofocus required/>
    <button type="submit">Enter</button>
  </form>
</body>
</html>`;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Public: live subscriber count for closed Big Cartel page
  if (path === "/api/list-count" || path.startsWith("/api/list-count/")) {
    return next();
  }

  const password = (env && env.SITE_PASSWORD) || "";
  if (!password) {
    return new Response("Site password not configured.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const expected = await tokenFor(password);
  const cookies = parseCookie(request.headers.get("Cookie") || "");
  if (cookies[COOKIE] === expected) {
    return next();
  }

  if (request.method === "POST") {
    let provided = "";
    const ctype = (request.headers.get("Content-Type") || "").toLowerCase();
    try {
      if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
        const form = await request.formData();
        provided = String(form.get("password") || "");
      } else {
        provided = String(await request.text() || "");
      }
    } catch (_) {
      provided = "";
    }

    if (provided === password) {
      const dest = path && path !== "/" ? path + url.search : "/" + url.search;
      return new Response(null, {
        status: 303,
        headers: {
          Location: dest || "/",
          "Set-Cookie": `${COOKIE}=${expected}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(gatePage(true), {
      status: 401,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(gatePage(false), {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
