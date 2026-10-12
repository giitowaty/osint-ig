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

module.exports = { classifyTopics, commentSentiment, scoreComment, normalizeText };
