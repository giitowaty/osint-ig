"use strict";

/* Prosty test bez frameworka: weryfikuje parsowanie payloadu i heurystykę płci
 * na zamockowanych danych web_profile_info (nie dotyka sieci). */

const assert = require("assert");
const { guessGender } = require("./names");
const {
  classifyTopics, commentSentiment, scoreComment, deriveInterests, classifyAccount,
} = require("./content");
const { buildPayload, collectConnections, usersFromResponse } = require("./server");

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

// --- heurystyka płci: podstawy ---
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

// --- duży słownik: polskie imiona (w tym z diakrytykami i ascii) ---
const FEMALE_NAMES = ["Małgorzata", "malgorzata", "Bożena", "Katarzyna",
  "Agnieszka", "Oliwia", "Kasia", "Gosia", "Zuzanna", "Weronika"];
const MALE_NAMES = ["Sławomir", "slawomir", "Przemysław", "Kuba", "Wojciech",
  "Grzegorz", "Krzysztof", "Łukasz", "Mateusz", "Zbigniew"];
for (const n of FEMALE_NAMES)
  ok(`PL żeńskie: ${n}`, () => assert.strictEqual(guessGender(n, "").gender, "female"));
for (const n of MALE_NAMES)
  ok(`PL męskie: ${n}`, () => assert.strictEqual(guessGender(n, "").gender, "male"));

// --- duży słownik: międzynarodowe ---
ok("EN: John -> male", () => assert.strictEqual(guessGender("John", "").gender, "male"));
ok("EN: Emily -> female", () => assert.strictEqual(guessGender("Emily", "").gender, "female"));
ok("username z imieniem: piotr.nowak99", () =>
  assert.strictEqual(guessGender("", "piotr.nowak99").gender, "male"));

// --- PESEL: przypadki brzegowe łamiące prostą regułę końcówki -a ---
ok("męskie na -a: Bonawentura", () => assert.strictEqual(guessGender("Bonawentura", "").gender, "male"));
ok("męskie na -a: Barnaba", () => assert.strictEqual(guessGender("Barnaba", "").gender, "male"));
ok("męskie na -a: Kosma", () => assert.strictEqual(guessGender("Kosma", "").gender, "male"));
ok("żeńskie nie na -a: Noemi", () => assert.strictEqual(guessGender("Noemi", "").gender, "female"));
ok("żeńskie nie na -a: Ingrid", () => assert.strictEqual(guessGender("Ingrid", "").gender, "female"));
// rzadkie imiona obce z rejestru PESEL (osoby żyjące)
ok("PESEL obce męskie: Mykola", () => assert.strictEqual(guessGender("Mykola", "").gender, "male"));

// --- content: kategorie ---
ok("klasyfikuje tematykę: podróże + jedzenie", () => {
  const posts = [
    { caption: "Wakacje w górach, piękna plaża #travel #podroze", alt: "" },
    { caption: "Najlepszy przepis na obiad #food #foodie", alt: "jedzenie na talerzu" },
  ];
  const t = classifyTopics(posts);
  const cats = t.topics.map((x) => x.category);
  assert.ok(cats.includes("Podróże"), "oczek. Podróże w " + cats.join(","));
  assert.ok(cats.includes("Jedzenie"), "oczek. Jedzenie w " + cats.join(","));
});
ok("brak treści -> null", () => assert.strictEqual(classifyTopics([]), null));
ok("rozszerzony leksykon: wiele granularnych kategorii, tylko obecne", () => {
  const posts = [
    { caption: "Nowy tatuaż #tattoo", alt: "" },
    { caption: "Czytam książkę #bookstagram", alt: "" },
    { caption: "Krypto #bitcoin #crypto", alt: "" },
    { caption: "Trekking w górach #tatry", alt: "góry" },
  ];
  const cats = classifyTopics(posts).ranked.map((x) => x.category);
  for (const c of ["Tatuaże", "Książki i literatura", "Finanse i krypto", "Góry i trekking"])
    assert.ok(cats.includes(c), "oczek. " + c + " w [" + cats.join(", ") + "]");
  // tylko wykryte kategorie — żadnych pustych/zerowych
  assert.ok(classifyTopics(posts).ranked.every((x) => x.hits > 0));
});

// --- content: sentyment ---
ok("komentarz pozytywny", () => assert.ok(scoreComment("Mega piękne zdjęcie 😍🔥") > 0));
ok("komentarz negatywny", () => assert.ok(scoreComment("słabe i brzydkie 👎") < 0));
ok("komentarz neutralny", () => assert.strictEqual(scoreComment("ok, dzień dobry"), 0));
ok("agregacja wydźwięku", () => {
  const s = commentSentiment([
    { text: "super mega 😍" }, { text: "cudownie ❤️" }, { text: "no słabe 👎" }, { text: "jest" },
  ]);
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.sampleSize, 4);
  assert.strictEqual(s.positive, 2);
  assert.strictEqual(s.negative, 1);
  assert.strictEqual(s.neutral, 1);
});
ok("brak komentarzy -> unavailable", () =>
  assert.strictEqual(commentSentiment([]).available, false));

// --- content: zainteresowania (konta oznaczane/wzmiankowane) ---
ok("zainteresowania zawierają oznaczone konta i hashtagi", () => {
  const posts = [
    { caption: "Trening z @fit_coach #gym #workout", alt: "", tagged: ["nike"] },
    { caption: "Kolejny trening 💪 @fit_coach #gym", alt: "", tagged: ["nike"] },
  ];
  const topics = classifyTopics(posts);
  const interests = deriveInterests(posts, topics, "jan_kowalski");
  const labels = interests.map((i) => i.label);
  assert.ok(labels.includes("@fit_coach"), "oczek. @fit_coach w " + labels.join(","));
  assert.ok(labels.includes("@nike"), "oczek. @nike (oznaczone) w " + labels.join(","));
  assert.ok(labels.includes("#workout"), "oczek. #workout w " + labels.join(","));
});
ok("zainteresowania pomijają własne konto", () => {
  const posts = [{ caption: "selfie @jan_kowalski @ktos", alt: "", tagged: [] }];
  const interests = deriveInterests(posts, classifyTopics(posts), "jan_kowalski");
  assert.ok(!interests.some((i) => i.label === "@jan_kowalski"));
});

// --- content: klasyfikacja konta ---
ok("klasyfikacja z kategorii IG", () => {
  const c = classifyAccount(
    { category: "Photographer", followers: 5000, following: 300, verified: false, private: false },
    null, []);
  assert.strictEqual(c.primary, "Fotograf");
});
ok("klasyfikacja influencera z sygnałów", () => {
  const c = classifyAccount(
    { category: "", followers: 500000, following: 200, verified: true, private: false },
    { topics: [{ category: "Moda", share: 0.3 }] }, []);
  assert.ok(/Influencer/.test(c.primary), "oczek. Influencer, mamy: " + c.primary);
});
ok("klasyfikacja konta prywatnego", () => {
  const c = classifyAccount(
    { category: "", followers: 300, following: 400, verified: false, private: true }, null, []);
  assert.strictEqual(c.primary, "Konto prywatne");
});

// --- powiązania (graf) ---
ok("collectConnections zbiera oznaczenia i @wzmianki, sortuje, pomija własne", () => {
  const posts = [
    { caption: "foto @brand_a @jan_kowalski", tagged: ["brand_a"] },
    { caption: "kolejne @brand_a", tagged: [] },
    { caption: "x", tagged: ["brand_b"] },
  ];
  const conns = collectConnections(posts, "jan_kowalski");
  const map = Object.fromEntries(conns.map((c) => [c.username, c.count]));
  assert.strictEqual(map["brand_a"], 3);        // 2x tag/wzmianka + 1x wzmianka
  assert.strictEqual(map["brand_b"], 1);
  assert.ok(!("jan_kowalski" in map));           // własne konto pominięte
  assert.strictEqual(conns[0].username, "brand_a"); // posortowane malejąco
});

// --- sesja: parsowanie odpowiedzi friendships ---
ok("usersFromResponse wyłuskuje nazwy, odporne na śmieci", () => {
  assert.deepStrictEqual(
    usersFromResponse({ users: [{ username: "a" }, { username: "b" }, { foo: 1 }, null] }),
    ["a", "b"]);
  assert.deepStrictEqual(usersFromResponse(null), []);
  assert.deepStrictEqual(usersFromResponse({}), []);
});

// --- payload / audience ---
const mockUser = {
  username: "demo",
  full_name: "Demo Konto",
  biography: "Testowe bio #foto #podróże @partner_brand",
  external_url: "https://example.com",
  profile_pic_url_hd: "https://img/pic.jpg",
  is_verified: true,
  is_private: false,
  category_name: "Photographer",
  is_professional_account: true,
  edge_followed_by: { count: 12000 },
  edge_follow: { count: 300 },
  edge_owner_to_timeline_media: {
    count: 2,
    edges: [
      { node: {
        __typename: "GraphImage", shortcode: "AAA", thumbnail_src: "t1",
        is_video: false, edge_liked_by: { count: 500 },
        edge_media_to_comment: { count: 20 },
        edge_media_to_caption: { edges: [{ node: { text: "Opis #foto #lato @partner_brand" } }] },
        accessibility_caption: "Zdjęcie plaży",
        edge_media_to_tagged_user: { edges: [{ node: { user: { username: "canon_polska" } } }] },
        edge_media_preview_comment: { edges: [
          { node: { text: "Mega piękne! 😍🔥", owner: { username: "anna_nowak", full_name: "Anna Nowak" } } },
          { node: { text: "no słabe 👎", owner: { username: "piotr99", full_name: "Piotr" } } },
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
ok("payload zawiera analizę treści", () => {
  assert.ok(payload.content, "brak content");
  assert.ok(payload.content.topics && payload.content.topics.topics.length >= 1);
  assert.strictEqual(payload.content.sentiment.available, true);
  assert.strictEqual(payload.content.sentiment.positive, 1); // "Mega piękne 😍🔥"
  assert.strictEqual(payload.content.sentiment.negative, 1); // "no słabe 👎"
});
ok("payload: kategoria, klasyfikacja i zainteresowania", () => {
  assert.strictEqual(payload.profile.category, "Photographer");
  assert.strictEqual(payload.content.classification.primary, "Fotograf");
  const labels = payload.content.interests.map((i) => i.label);
  assert.ok(labels.includes("@partner_brand"), "oczek. @partner_brand (wzmianka) w " + labels.join(","));
  assert.ok(labels.includes("@canon_polska"), "oczek. @canon_polska (oznaczone) w " + labels.join(","));
});

console.log(`\n${passed} testów przeszło ✓`);

// --- błędy i walidacja (nowy backend) ---
const { ApiError, toApiError } = require("./errors");
const { parseUsername } = require("./server");
let p2 = 0;
const ok2 = (name, fn) => { fn(); p2++; console.log("  ✓ " + name); };
ok2("parseUsername akceptuje @nick i link profilu", () => {
  assert.strictEqual(parseUsername("@Jan.Kowalski"), "Jan.Kowalski");
  assert.strictEqual(parseUsername("https://www.instagram.com/nasa/?hl=pl"), "nasa");
});
ok2("parseUsername odrzuca niedozwolone znaki z kodem BAD_REQUEST", () => {
  assert.throws(() => parseUsername("zła nazwa"), (e) => e instanceof ApiError && e.code === "BAD_REQUEST");
  assert.throws(() => parseUsername(""), (e) => e.code === "BAD_REQUEST");
});
ok2("toApiError rozpoznaje timeout i błąd sieci", () => {
  const t = new Error("x"); t.name = "TimeoutError";
  assert.strictEqual(toApiError(t).code, "TIMEOUT");
  const n = new TypeError("fetch failed"); n.cause = { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" };
  assert.strictEqual(toApiError(n).code, "NETWORK_ERROR");
  assert.strictEqual(toApiError(new Error("boom")).code, "INTERNAL");
});
ok2("ApiError.toJSON niesie kod, podpowiedź i status", () => {
  const j = new ApiError("IG_RATE_LIMITED", { stage: "fetch" }).toJSON();
  assert.strictEqual(j.status, 429);
  assert.ok(j.hint && j.stage === "fetch");
});
console.log(`\n${p2} testów błędów przeszło ✓`);

// --- ciasteczka sesji (x-ig-cookies) ---
const { sessionFromHeaders } = require("./cookies");
let p3 = 0;
const ok3 = (name, fn) => { fn(); p3++; console.log("  ✓ " + name); };
ok3("x-ig-cookies: komplet → nagłówek Cookie + CSRF + userId", () => {
  const s = sessionFromHeaders({ "x-ig-cookies": "sessionid=123%3Aabc%3A9; csrftoken=TOK; ds_user_id=123; mid=Zz-1" });
  assert.strictEqual(s.cookie, "sessionid=123%3Aabc%3A9; csrftoken=TOK; ds_user_id=123; mid=Zz-1");
  assert.strictEqual(s.csrf, "TOK");
  assert.strictEqual(s.userId, "123");
});
ok3("pomija ciasteczka spoza białej listy", () => {
  const s = sessionFromHeaders({ "x-ig-cookies": "sessionid=1%3Ax; _ga=GA1; tracking=zzz" });
  assert.deepStrictEqual(s.names, ["sessionid"]);
});
ok3("brak sessionid → SESSION_MISSING", () => {
  assert.throws(() => sessionFromHeaders({ "x-ig-cookies": "csrftoken=a" }), (e) => e.code === "SESSION_MISSING");
});
ok3("wstrzyknięcie nagłówka (CR/LF, spacje) → BAD_REQUEST", () => {
  assert.throws(() => sessionFromHeaders({ "x-ig-cookies": "sessionid=a\r\nX-Evil: 1" }), (e) => e.code === "BAD_REQUEST");
  assert.throws(() => sessionFromHeaders({ "x-ig-session": "abc def" }), (e) => e.code === "BAD_REQUEST");
});
ok3("tryb zgodności: samo sessionid w x-ig-session", () => {
  const s = sessionFromHeaders({ "x-ig-session": "55%3Aqq%3A1" });
  assert.strictEqual(s.cookie, "sessionid=55%3Aqq%3A1");
  assert.strictEqual(s.userId, "55");
});
ok3("brak nagłówków → null (analiza anonimowa)", () => assert.strictEqual(sessionFromHeaders({}), null));
console.log(`\n${p3} testów ciasteczek przeszło ✓`);
