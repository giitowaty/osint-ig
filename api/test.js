"use strict";

/* Prosty test bez frameworka: weryfikuje parsowanie payloadu i heurystykę płci
 * na zamockowanych danych web_profile_info (nie dotyka sieci). */

const assert = require("assert");
const { guessGender } = require("./names");
const { buildPayload } = require("./server");

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

// --- heurystyka płci ---
ok("rozpoznaje imię żeńskie", () =>
  assert.strictEqual(guessGender("Anna Kowalska", "anna_k").gender, "female"));
ok("rozpoznaje imię męskie", () =>
  assert.strictEqual(guessGender("Piotr Nowak", "p.nowak").gender, "male"));
ok("imię z username", () =>
  assert.strictEqual(guessGender("", "magdalena.xoxo").gender, "female"));
ok("dwuznaczne -> unknown", () =>
  assert.strictEqual(guessGender("Alex", "alex99").gender, "unknown"));
ok("losowy nick -> unknown", () =>
  assert.strictEqual(guessGender("", "xqz_777").gender, "unknown"));

// --- payload / audience ---
const mockUser = {
  username: "demo",
  full_name: "Demo Konto",
  biography: "Testowe bio #foto #podróże",
  external_url: "https://example.com",
  profile_pic_url_hd: "https://img/pic.jpg",
  is_verified: true,
  is_private: false,
  edge_followed_by: { count: 12000 },
  edge_follow: { count: 300 },
  edge_owner_to_timeline_media: {
    count: 2,
    edges: [
      { node: {
        __typename: "GraphImage", shortcode: "AAA", thumbnail_src: "t1",
        is_video: false, edge_liked_by: { count: 500 },
        edge_media_to_comment: { count: 20 },
        edge_media_to_caption: { edges: [{ node: { text: "Opis #foto #lato" } }] },
        accessibility_caption: "Zdjęcie plaży",
        edge_media_preview_comment: { edges: [
          { node: { owner: { username: "anna_nowak", full_name: "Anna Nowak" } } },
          { node: { owner: { username: "piotr99", full_name: "Piotr" } } },
        ]},
        edge_media_preview_like: { edges: [
          { node: { username: "xqz_777", full_name: "" } },
        ]},
      }},
      { node: {
        __typename: "GraphVideo", shortcode: "BBB", thumbnail_src: "t2",
        is_video: true, edge_media_preview_like: { count: 800, edges: [
          { node: { username: "magdalena.k", full_name: "Magda" } },
        ]},
        edge_media_to_comment: { count: 40 },
        edge_media_to_caption: { edges: [{ node: { text: "Wideo #lato" } }] },
      }},
    ],
  },
};

const payload = buildPayload(mockUser, "demo");

ok("profil znormalizowany", () => {
  assert.strictEqual(payload.profile.followers, 12000);
  assert.strictEqual(payload.profile.posts, 2);
  assert.strictEqual(payload.profile.verified, true);
});
ok("posty rozpoznane z typami", () => {
  assert.strictEqual(payload.posts.length, 2);
  assert.strictEqual(payload.posts[0].type, "image");
  assert.strictEqual(payload.posts[1].type, "video");
  assert.strictEqual(payload.posts[0].likes, 500);
});
ok("audience zbiera próbkę i szacuje płeć", () => {
  assert.strictEqual(payload.audience.available, true);
  assert.strictEqual(payload.audience.sampleSize, 4); // anna, piotr, xqz, magdalena
  assert.strictEqual(payload.audience.female, 2);      // anna, magdalena
  assert.strictEqual(payload.audience.male, 1);        // piotr
  assert.strictEqual(payload.audience.unknown, 1);     // xqz
});

console.log(`\n${passed} testów przeszło ✓`);
