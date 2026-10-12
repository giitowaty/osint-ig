"use strict";

/* ----------------------------------------------------------------------------
 * Analiza treści konta: kategorie tematyczne postów oraz wydźwięk (sentyment)
 * komentarzy. Czysta heurystyka (leksykony PL+EN + emoji), bez zależności.
 * To przybliżenie — oznaczaj w UI jako orientacyjne.
 * -------------------------------------------------------------------------- */

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/* ------------------------------ Kategorie -------------------------------- */
// Słowa kluczowe (PL+EN, bez diakrytyków) → kategoria. Dopasowanie po rdzeniu
// (substring), więc "podroz" złapie podróż/podróże/podróżniczy.
const TOPIC_LEXICON = {
  "Podróże": ["podroz", "travel", "wakacj", "vacation", "trip", "gory ", "mountain", "plaza", "beach", "zwiedza", "wyjazd", "explore", "wanderlust", "hotel", "airport", "lotnisko", "wycieczk"],
  "Jedzenie": ["jedzen", "food", "przepis", "recipe", "restauracj", "kuchni", "foodporn", "pyszn", "obiad", "sniadan", "kawa", "coffee", "pizza", "burger", "cake", "ciasto", "dinner", "lunch", "foodie"],
  "Moda": ["moda", "fashion", "outfit", "ootd", "stylizacj", "ubran", "style", "trend", "zakupy", "shopping", "lookbook", "sukienk", "buty", "denim"],
  "Uroda": ["makijaz", "makeup", "uroda", "beauty", "kosmetyk", "skincare", "paznokc", "fryzur", "hair", "lashes", "brows", "glam", "mua"],
  "Fitness i sport": ["fitness", "gym", "silown", "trening", "workout", "sport", "biegan", "running", "fit ", "fitfam", "zdrow", "health", "pilka", "football", "koszykowk", "crossfit", "joga", "yoga", "maraton"],
  "Zwierzęta": ["pies", "piesek", "dog", "kot ", "kotek", "cat", "zwierz", "pet", "puppy", "kitten", "dogsof", "catsof", "koni", "horse"],
  "Natura": ["natura", "nature", "przyrod", "las ", "forest", "zachod slonca", "sunset", "sunrise", "krajobraz", "landscape", "jezioro", "morze", "ocean", "wschod slonca", "mountains"],
  "Sztuka i foto": ["sztuka", " art", "art ", "rysun", "drawing", "malarstw", "design", "tattoo", "tatuaz", "foto", "photo", "photograph", "fotograf", "ilustracj", "artist", "portret"],
  "Muzyka": ["muzyka", "music", "koncert", "concert", "song", "piosenk", "zespol", "band", " dj", "festiwal", "festival", "album", "rap", "hiphop", "gitar", "spiew"],
  "Biznes i motywacja": ["biznes", "business", "praca", " work", "marketing", "startup", "przedsiebiorc", "motywacj", "motivation", "sukces", "success", "sprzedaz", "ecommerce", "inwest", "mindset", "coaching"],
  "Technologia i gry": ["tech", "technolog", "gaming", " gry", "gra ", "komputer", "programow", "coding", "developer", " ai ", "sztuczna inteligencj", "startup", "gadzet", "esport", "playstation", "xbox"],
  "Rodzina i dzieci": ["rodzin", "family", "dziecko", "dzieci", "baby", "kids", "mama", "tata", "parenting", "ciaza", "pregnan", "macierzyn", "newborn"],
  "Imprezy": ["imprez", "party", " klub", "club", "nightlife", "weekend", "zabawa", "urodzin", "birthday", "wesele", "wedding"],
  "Motoryzacja": ["samochod", " auto", " car ", "cars", "motoryzacj", "bmw", "audi", "mercedes", " moto", "motocykl", "motorcycle", "jdm", "tuning"],
  "Humor i memy": ["mem", "meme", "humor", "smieszn", "funny", " lol", "zart", "comedy", "heheszk"],
  "Uroczystości": ["swieta", "christmas", "wielkanoc", "sylwester", "walentynk", "halloween"],
};

/**
 * Klasyfikuje treść postów do kategorii na podstawie opisów + hashtagów + alt.
 * Zwraca posortowaną listę { category, hits, share } i udział bez kategorii.
 */
function classifyTopics(posts) {
  if (!posts || !posts.length) return null;
  const text = normalizeText(
    posts.map((p) => `${p.caption || ""} ${p.alt || ""}`).join(" \n ")
  );

  const scores = {};
  let total = 0;
  for (const [cat, kws] of Object.entries(TOPIC_LEXICON)) {
    let hits = 0;
    for (const kw of kws) {
      // zlicz wystąpienia rdzenia słowa
      let idx = 0;
      while ((idx = text.indexOf(kw, idx)) !== -1) { hits++; idx += kw.length; }
    }
    if (hits > 0) { scores[cat] = hits; total += hits; }
  }

  const ranked = Object.entries(scores)
    .map(([category, hits]) => ({ category, hits, share: total ? hits / total : 0 }))
    .sort((a, b) => b.hits - a.hits);

  return { ranked, matched: total, topics: ranked.slice(0, 5) };
}

/* ------------------------------ Sentyment -------------------------------- */
const POSITIVE = [
  // PL
  "super", "swietn", "piekn", "ladn", "kocham", "uwielbiam", "zajebist", "mega",
  "genialn", "cudown", "najlepsz", "brawo", "gratulacj", "wspanial", "rewelacj",
  "fajn", "sliczn", "przepiekn", "bomba", "petarda", "zakochan", "pysznie",
  "bosk", "idealn", "miodzio", "czad", "robi wrazenie", "pieknie", "git",
  // EN
  "love", "amazing", "beautiful", "great", "perfect", "nice", "awesome", "best",
  "gorgeous", "stunning", "wow", "incredible", "lovely", "cool", "fantastic",
  "wonderful", "cute", "adorable", "goals", "fire", "slay", "queen", "king",
  "congrat", "respect", "legend",
];
const NEGATIVE = [
  // PL
  "slab", "brzydk", "nienawidz", "beznadziej", "zenad", "tragedi", "fuj",
  "okropn", "glupi", "nuda", "chlam", "masakra", "porazk", "obrzydliw",
  "zalosn", "sciema", "kicz", "wstyd", "paskudn", "badziew",
  // EN
  "hate", "ugly", " bad", "worst", "awful", "boring", "terrible", "disgust",
  "trash", "cringe", "lame", "stupid", "gross", "disappoint", "nasty", "fake",
];
// Emoji o wyraźnym wydźwięku.
const EMOJI_POS = ["❤️", "❤", "🧡", "💛", "💚", "💙", "💜", "🔥", "😍", "😘", "🥰", "😻", "👏", "🙌", "💕", "💗", "💖", "✨", "🤩", "😁", "😄", "😃", "👍", "💪", "🥳", "😎", "💯", "🌟", "⭐", "👑"];
const EMOJI_NEG = ["😡", "🤬", "🤮", "👎", "💩", "😭", "😢", "🙄", "🤢", "😠", "😤", "💔", "😒", "🤡"];

function countAny(hay, list) {
  let c = 0;
  for (const t of list) {
    let idx = 0;
    while ((idx = hay.indexOf(t, idx)) !== -1) { c++; idx += t.length; }
  }
  return c;
}

/** Wynik sentymentu pojedynczego komentarza: dodatni / zerowy / ujemny. */
function scoreComment(raw) {
  const emojiPos = countAny(raw, EMOJI_POS);
  const emojiNeg = countAny(raw, EMOJI_NEG);
  const norm = normalizeText(raw);
  let pos = countAny(norm, POSITIVE) + emojiPos;
  let neg = countAny(norm, NEGATIVE) + emojiNeg;
  // prosta negacja: "nie <pozytyw>" osłabia pozytyw
  if (/\bnie\s+\w/.test(norm) && pos > 0) { pos -= 1; neg += 1; }
  return pos - neg;
}

/**
 * Agreguje wydźwięk listy komentarzy ({ text }).
 * Zwraca udziały pozytywnych/neutralnych/negatywnych + przykłady.
 */
function commentSentiment(comments) {
  const texts = (comments || []).map((c) => c && c.text).filter((t) => t && t.trim());
  if (!texts.length) {
    return { available: false, reason: "Brak tekstu komentarzy w podglądzie IG." };
  }
  let positive = 0, neutral = 0, negative = 0;
  const examples = { positive: null, negative: null };
  for (const t of texts) {
    const s = scoreComment(t);
    if (s > 0) { positive++; if (!examples.positive) examples.positive = t.slice(0, 120); }
    else if (s < 0) { negative++; if (!examples.negative) examples.negative = t.slice(0, 120); }
    else neutral++;
  }
  const total = texts.length;
  return {
    available: true,
    sampleSize: total,
    positive, neutral, negative,
    positivePct: Math.round((positive / total) * 100),
    neutralPct: Math.round((neutral / total) * 100),
    negativePct: Math.round((negative / total) * 100),
    tone: positive > negative * 1.5 ? "pozytywny"
      : negative > positive * 1.5 ? "negatywny"
      : "mieszany/neutralny",
    examples,
  };
}

/* ---------------------------- Zainteresowania ---------------------------- */
// Zbyt ogólne hashtagi — pomijamy jako „zainteresowanie”.
const GENERIC_TAGS = new Set([
  "instagram", "instagood", "insta", "instadaily", "photooftheday", "picoftheday",
  "love", "follow", "followme", "like", "like4like", "f4f", "l4l", "repost",
  "polska", "poland", "pl", "igers", "bestoftheday", "happy", "fun", "ootd",
  "viral", "reels", "reel", "explore", "fyp", "trend", "trending",
]);

/**
 * Buduje listę zainteresowań z tego, co konto publikuje i udostępnia:
 * kategorie tematyczne (ogólne), konkretne hashtagi oraz konta oznaczane /
 * wzmiankowane (oznaczeni partnerzy, współautorzy collab/regramów, @wzmianki).
 * Uwaga: relacje (stories) nie są dostępne z publicznego API bez logowania.
 * Zwraca [{ label, weight, kind }].
 */
function deriveInterests(posts, topicsResult, ownUsername) {
  if (!posts || !posts.length) return null;

  const own = normalizeText(ownUsername || "");
  const tagFreq = new Map();
  const accFreq = new Map();
  const bumpAcc = (raw) => {
    const a = String(raw || "").toLowerCase().replace(/^@/, "").trim();
    if (!a || normalizeText(a) === own) return;
    accFreq.set(a, (accFreq.get(a) || 0) + 1);
  };

  for (const p of posts) {
    const text = `${p.caption || ""} ${p.alt || ""}`;
    for (const m of text.matchAll(/#([\p{L}\p{N}_]{2,30})/gu)) {
      const t = normalizeText(m[1]);
      if (t.length < 2 || GENERIC_TAGS.has(t)) continue;
      tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
    }
    // @wzmianki w opisie
    for (const m of text.matchAll(/@([A-Za-z0-9._]{2,30})/g)) bumpAcc(m[1]);
    // konta oznaczone na zdjęciu / współautorzy (collab, regram)
    for (const t of p.tagged || []) bumpAcc(t);
  }

  const interests = [];
  // 1) kategorie tematyczne jako zainteresowania ogólne
  if (topicsResult && topicsResult.ranked) {
    for (const t of topicsResult.ranked.slice(0, 6)) {
      interests.push({ label: t.category, weight: t.hits, kind: "kategoria" });
    }
  }
  // 2) konta oznaczane / wzmiankowane (kogo udostępnia i z kim współpracuje)
  const topAcc = [...accFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  for (const [acc, freq] of topAcc) {
    interests.push({ label: "@" + acc, weight: freq + 0.5, kind: "konto" });
  }
  // 3) konkretne hashtagi (pomijając te, które powielają nazwę kategorii)
  const catWords = new Set(interests.map((i) => normalizeText(i.label)));
  const topTags = [...tagFreq.entries()]
    .filter(([t]) => !catWords.has(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  for (const [tag, freq] of topTags) {
    interests.push({ label: "#" + tag, weight: freq, kind: "hashtag" });
  }

  interests.sort((a, b) => b.weight - a.weight);
  return interests.slice(0, 16);
}

/* ------------------------- Klasyfikacja konta ---------------------------- */
// Mapowanie typowych kategorii IG (EN) → czytelny archetyp PL.
const CATEGORY_MAP = [
  [/photograph/i, "Fotograf"],
  [/music|musician|band|dj/i, "Muzyk / zespół"],
  [/artist|art\b/i, "Artysta"],
  [/athlete|sports/i, "Sportowiec"],
  [/model/i, "Model(ka)"],
  [/actor|actress/i, "Aktor(ka)"],
  [/blogger|personal blog|digital creator|content creator/i, "Twórca / bloger"],
  [/public figure/i, "Osoba publiczna"],
  [/entrepreneur|business/i, "Przedsiębiorca / biznes"],
  [/chef|restaurant|food/i, "Gastronomia / kulinaria"],
  [/health|beauty|fitness/i, "Uroda / zdrowie / fitness"],
  [/clothing|brand|product|shopping/i, "Marka / sklep"],
  [/gaming|gamer/i, "Gaming"],
  [/comedian/i, "Komik / rozrywka"],
  [/writer|journalist|media/i, "Media / pisarstwo"],
  [/nonprofit|community|education/i, "Organizacja / społeczność"],
];

function mapCategory(cat) {
  for (const [re, label] of CATEGORY_MAP) if (re.test(cat)) return label;
  return cat; // nieznana kategoria — pokaż surową
}

/**
 * Klasyfikuje konto do archetypu na podstawie sygnałów IG (kategoria, flagi,
 * zasięg, ratio, weryfikacja, dominująca tematyka). Zwraca
 * { primary, labels: [{label, reason}], confidence }.
 */
function classifyAccount(profile, topicsResult, posts) {
  const labels = [];
  const f = profile.followers;
  const ratio = profile.following ? f / profile.following : null;
  const topCat = topicsResult && topicsResult.topics && topicsResult.topics[0];

  let primary = null;

  if (profile.private) {
    primary = "Konto prywatne";
    labels.push({ label: "Prywatne", reason: "Profil ustawiony jako prywatny." });
  }

  // Kategoria nadana w IG — najsilniejszy sygnał.
  if (profile.category) {
    const mapped = mapCategory(profile.category);
    if (!primary) primary = mapped;
    labels.push({ label: mapped, reason: `Kategoria konta w IG: „${profile.category}”.` });
  }
  if (profile.isBusiness)
    labels.push({ label: "Konto firmowe", reason: "Oznaczone jako konto biznesowe." });
  else if (profile.isProfessional)
    labels.push({ label: "Konto profesjonalne", reason: "Oznaczone jako konto profesjonalne/twórcy." });

  // Zasięg / wpływ.
  if (f != null) {
    if (f >= 1_000_000) labels.push({ label: "Mega-zasięg", reason: "Ponad 1 mln obserwujących." });
    else if (f >= 100_000) labels.push({ label: "Duży zasięg", reason: "Ponad 100 tys. obserwujących." });
  }
  if (profile.verified)
    labels.push({ label: "Zweryfikowane", reason: "Konto ma niebieski znaczek." });

  // Archetyp z sygnałów, gdy brak kategorii IG.
  if (!primary || primary === "Konto prywatne") {
    if (f != null && f >= 100_000 && ratio != null && ratio >= 10) {
      const p2 = "Influencer / twórca";
      if (!primary) primary = p2;
      labels.push({ label: p2, reason: "Duży zasięg i wyraźna nadwyżka obserwujących nad obserwowanymi." });
    } else if (topCat && topCat.share >= 0.4) {
      const p2 = `Profil tematyczny: ${topCat.category}`;
      if (!primary) primary = p2;
      labels.push({ label: p2, reason: `Treści zdominowane przez temat: ${topCat.category}.` });
    } else if (!primary) {
      primary = (f != null && f < 5000) ? "Osoba prywatna / konto osobiste" : "Konto osobiste";
      labels.push({ label: primary, reason: "Brak kategorii zawodowej i cech konta publicznego." });
    }
  }

  // Dominująca tematyka jako dodatkowa etykieta.
  if (topCat && !labels.some((l) => l.label.includes(topCat.category)))
    labels.push({ label: `Tematyka: ${topCat.category}`, reason: `Najczęstszy temat postów (${Math.round(topCat.share * 100)}%).` });

  // Pewność — rośnie z liczbą twardych sygnałów.
  let conf = 0;
  if (profile.category) conf += 0.5;
  if (profile.verified || profile.isBusiness || profile.isProfessional) conf += 0.2;
  if (topCat && topCat.share >= 0.4) conf += 0.2;
  if (f != null) conf += 0.1;

  return { primary: primary || "Nieokreślone", labels, confidence: Math.min(1, conf) };
}

module.exports = {
  classifyTopics, commentSentiment, scoreComment, normalizeText,
  deriveInterests, classifyAccount,
};
