import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { onRequest as gate } from "../_middleware.js";
import { onRequestGet as moderateGet, onRequestPost as moderatePost } from "../api/review-moderate.js";
import { onRequestGet, onRequestPost } from "../api/reviews.js";
import {
  escapeHtml,
  parseReview,
  signToken,
  toPublic,
  verifyToken,
} from "./reviews.js";

const SECRET = "test-signing-secret-0123456789";
const XSS = `</p><script>alert(1)</script><img src=x onerror=alert(1)>`;

class MemoryKV {
  constructor() {
    this.store = new Map();
    this.puts = [];
  }
  async get(key, type) {
    const row = this.store.get(key);
    if (!row) return null;
    if (row.exp && row.exp < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return type === "json" ? JSON.parse(row.value) : row.value;
  }
  async put(key, value, opts = {}) {
    this.puts.push({ key, opts });
    const exp = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0;
    this.store.set(key, { value: String(value), exp });
  }
  async delete(key) {
    this.store.delete(key);
  }
  async list({ prefix } = {}) {
    const keys = [...this.store.keys()]
      .filter((name) => !prefix || name.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

function envWith(kv, extra = {}) {
  return {
    REVIEWS: kv,
    REVIEW_SIGNING_SECRET: SECRET,
    RESEND_API_KEY: "re_test",
    RESEND_OWNER: "sbackemoto@gmail.com",
    ...extra,
  };
}

function postReview(body, ip = "203.0.113.9") {
  return new Request("https://emotionrides.com/api/reviews", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip,
    },
    body: JSON.stringify(body),
  });
}

const good = {
  rating: 5,
  name: "Riley",
  product: "Hoodie",
  comfort: "Super comfy",
  text: "Heavy fleece, the fit, the wash.",
  email: "Riley.Rider@Example.com",
};

let emails;

beforeEach(() => {
  emails = [];
  globalThis.fetch = async (url, init) => {
    emails.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200 });
  };
});

afterEach(() => {
  delete globalThis.fetch;
});

describe("parse and escape", () => {
  test("accepts a normal review and canonicalizes product, comfort, and email", () => {
    const parsed = parseReview({ ...good, product: "hoodie", comfort: "super comfy" });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.product, "Hoodie");
    assert.equal(parsed.value.comfort, "Super comfy");
    assert.equal(parsed.value.email, "riley.rider@example.com");
  });

  test("rejects bad ratings, emails-as-names, bad comfort, and long link spam", () => {
    assert.equal(parseReview({ ...good, rating: 0 }).ok, false);
    assert.equal(parseReview({ ...good, rating: true }).ok, false);
    assert.equal(parseReview({ ...good, name: "a@b.com" }).ok, false);
    assert.match(parseReview({ ...good, text: "a" }).error, /what you like/);
    assert.match(parseReview({ ...good, comfort: "" }).error, /comfortable/);
    assert.equal(parseReview({ ...good, comfort: "itchy" }).ok, false);
    assert.equal(parseReview({ ...good, product: "Hat" }).ok, false);
    const spam = parseReview({
      ...good,
      text: "see https://a.example https://b.example www.c.example now",
    });
    assert.equal(spam.ok, false);
  });

  test("honeypot short-circuits", () => {
    const parsed = parseReview({ ...good, fax_number: "filled" });
    assert.equal(parsed.honeypot, true);
  });

  test("escapeHtml neutralizes markup", () => {
    assert.equal(escapeHtml(XSS).includes("<script>"), false);
    assert.match(escapeHtml(XSS), /&lt;script&gt;/);
  });

  test("public view drops email and keeps both clothing answers", () => {
    const pub = toPublic({
      name: "Riley",
      rating: 5,
      product: "Tee",
      comfort: "Comfy",
      text: "The wash holds up.",
      email: "secret@example.com",
      createdAt: "2026-10-08T12:00:00.000Z",
    });
    assert.equal(pub.email, undefined);
    assert.equal(pub.comfort, "Comfy");
    assert.equal(JSON.stringify(pub).includes("secret@example.com"), false);
    assert.equal(toPublic({ ...pub, comfort: "rides great" }), null);
  });
});

describe("tokens", () => {
  test("round-trips and rejects tampering and expiry", async () => {
    const token = await signToken(SECRET, {
      id: "11111111-1111-4111-8111-111111111111",
      action: "approve",
      exp: Date.now() + 60_000,
    });
    const ok = await verifyToken(SECRET, token);
    assert.equal(ok.action, "approve");
    assert.equal(await verifyToken("other-secret-0123456789", token), null);
    assert.equal(await verifyToken(SECRET, token + "x"), null);
    const expired = await signToken(SECRET, {
      id: "11111111-1111-4111-8111-111111111111",
      action: "delete",
      exp: Date.now() - 1000,
    });
    assert.equal(await verifyToken(SECRET, expired), null);
  });
});

describe("HTTP", () => {
  test("hides the feature when the binding or secrets are missing", async () => {
    const res = await onRequestGet({
      request: new Request("https://emotionrides.com/api/reviews"),
      env: {},
    });
    assert.deepEqual(await res.json(), {
      configured: false,
      reviews: [],
      count: 0,
      average: null,
    });
    const post = await onRequestPost({
      request: postReview(good),
      env: { REVIEWS: new MemoryKV() },
    });
    assert.equal(post.status, 503);
  });

  test("pending reviews are not public, email is private, markup is escaped", async () => {
    const kv = new MemoryKV();
    const env = envWith(kv);
    const created = await onRequestPost({
      request: postReview({ ...good, name: "Riley", text: "Fits great. " + XSS }),
      env,
    });
    assert.equal(created.status, 200);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].body.to[0], "sbackemoto@gmail.com");
    assert.equal(emails[0].body.html.includes("<script>"), false);
    assert.match(emails[0].body.html, /&lt;script&gt;/);
    assert.match(emails[0].body.html, /riley\.rider@example\.com/);
    assert.match(emails[0].body.reply_to, /riley\.rider@example\.com/);
    assert.match(emails[0].body.html, /Is it comfortable/);
    assert.match(emails[0].body.html, /Super comfy/);
    assert.match(emails[0].body.html, /What do you like about it/);
    assert.match(emails[0].body.text, /Is it comfortable\?\nSuper comfy/);
    assert.match(emails[0].body.text, /What do you like about it\?/);
    assert.doesNotMatch(emails[0].body.html, /how does it ride/i);
    assert.doesNotMatch(emails[0].body.text, /how does it ride/i);

    const listed = await onRequestGet({
      request: new Request("https://emotionrides.com/api/reviews"),
      env,
    });
    const body = await listed.json();
    assert.equal(body.configured, true);
    assert.equal(body.count, 0);
    assert.equal(JSON.stringify(body).includes("example.com"), false);

    const stored = [...kv.store.keys()].filter((key) => key.startsWith("review:"));
    assert.equal(stored.length, 1);
    const saved = JSON.parse(kv.store.get(stored[0]).value);
    assert.equal(saved.status, "pending");
    assert.equal(saved.comfort, "Super comfy");
    assert.equal(saved.email, "riley.rider@example.com");

    const approveUrl = emails[0].body.text.split("Approve (opens a confirm page):\n")[1].split("\n")[0];
    const token = new URL(approveUrl).searchParams.get("token");
    const confirm = await moderateGet({
      request: new Request(approveUrl),
      env,
    });
    const confirmHtml = await confirm.text();
    assert.equal(confirm.status, 200);
    assert.equal(confirmHtml.includes("<script>"), false);
    assert.match(confirmHtml, /&lt;script&gt;/);
    assert.equal(confirmHtml.includes("example.com"), false);
    assert.match(confirmHtml, /Approve/);
    assert.match(confirmHtml, /Is it comfortable/);
    assert.match(confirmHtml, /What do you like about it/);

    const approved = await moderatePost({
      request: new Request("https://emotionrides.com/api/review-moderate", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }),
      env,
    });
    assert.equal(approved.status, 303);
    assert.equal(approved.headers.get("Location"), "/api/review-moderate?done=approved");

    const after = await (await onRequestGet({
      request: new Request("https://emotionrides.com/api/reviews"),
      env,
    })).json();
    assert.equal(after.count, 1);
    assert.equal(after.average, 5);
    assert.equal(after.reviews[0].name, "Riley");
    assert.equal(after.reviews[0].product, "Hoodie");
    assert.equal(after.reviews[0].comfort, "Super comfy");
    assert.equal(after.reviews[0].email, undefined);
    assert.equal(JSON.stringify(after).includes("example.com"), false);
    assert.match(after.reviews[0].text, /script/);

    const approvedValue = JSON.parse(kv.store.get("approved:" + saved.id).value);
    assert.equal(approvedValue.email, undefined);

    const again = await moderatePost({
      request: new Request("https://emotionrides.com/api/review-moderate", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      }),
      env,
    });
    assert.equal(again.headers.get("Location"), "/api/review-moderate?done=already");

    const deleteUrl = emails[0].body.text.split("Delete (opens a confirm page):\n")[1].split("\n")[0].trim();
    const deleteToken = new URL(deleteUrl).searchParams.get("token");
    const removed = await moderatePost({
      request: new Request("https://emotionrides.com/api/review-moderate", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: deleteToken }),
      }),
      env,
    });
    assert.equal(removed.headers.get("Location"), "/api/review-moderate?done=deleted");
    const empty = await (await onRequestGet({
      request: new Request("https://emotionrides.com/api/reviews"),
      env,
    })).json();
    assert.equal(empty.count, 0);
  });

  test("honeypot stores nothing and rate limit kicks in", async () => {
    const kv = new MemoryKV();
    const env = envWith(kv);
    const bot = await onRequestPost({
      request: postReview({ ...good, fax_number: "http://spam.example" }, "203.0.113.10"),
      env,
    });
    assert.equal(bot.status, 200);
    assert.equal([...kv.store.keys()].some((key) => key.startsWith("review:")), false);
    assert.equal(emails.length, 0);

    for (let i = 0; i < 5; i++) {
      const res = await onRequestPost({
        request: postReview({ ...good, email: "", text: "Fleece " + i + " feels solid." }, "198.51.100.4"),
        env,
      });
      assert.equal(res.status, 200);
    }
    const blocked = await onRequestPost({
      request: postReview({ ...good, email: "", text: "One more note on the wash." }, "198.51.100.4"),
      env,
    });
    assert.equal(blocked.status, 429);
  });

  test("bad done query is not reflected", async () => {
    const res = await moderateGet({
      request: new Request("https://emotionrides.com/api/review-moderate?done=%3Cscript%3E"),
      env: envWith(new MemoryKV()),
    });
    const html = await res.text();
    assert.equal(res.status, 400);
    assert.equal(html.includes("<script>"), false);
    assert.match(html, /isn’t valid|isn&#39;t valid/);
  });

  test("failed email does not leave a pending review", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    const kv = new MemoryKV();
    const res = await onRequestPost({
      request: postReview({ ...good, email: "" }),
      env: envWith(kv),
    });
    assert.equal(res.status, 502);
    assert.equal([...kv.store.keys()].some((key) => key.startsWith("review:")), false);
  });
});

describe("open site", () => {
  test("middleware lets every request through, with or without a password", async () => {
    const paths = ["/", "/api/reviews", "/api/review-moderate?token=abc", "/api/subscribe"];
    for (const env of [{}, { SITE_PASSWORD: "secret-pass" }]) {
      for (const path of paths) {
        let called = false;
        const res = await gate({
          request: new Request("https://emotionrides.com" + path),
          env,
          next: async () => {
            called = true;
            return new Response("ok", { status: 200 });
          },
        });
        assert.equal(called, true, path);
        assert.equal(res.status, 200);
        assert.equal(await res.text(), "ok");
      }
    }
  });
});
