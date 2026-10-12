# OSINT-IG Collector — rozszerzenie przeglądarki

Małe rozszerzenie (Chrome/Edge, Manifest V3), które działa w **Twojej
zalogowanej sesji Instagrama** i pozwala:

- zobaczyć, na jakim koncie jesteś zalogowany,
- **pobrać listę obserwujących / obserwowanych** dowolnego profilu i skopiować
  ją do schowka (wklejasz w OSINT-IG → zakładka *Sieć* → „Wklej listę”),
- **skopiować `sessionid`** jednym kliknięciem (gdybyś wolał tryb backendowy w
  aplikacji, bez grzebania w DevTools).

Zapytania idą bezpośrednio z Twojej przeglądarki do Instagrama (z Twoimi cookie);
**nic nie jest wysyłane na żaden zewnętrzny serwer** — wynik trafia tylko do
schowka i pola tekstowego w okienku rozszerzenia.

## Instalacja (tryb deweloperski)

1. Otwórz `chrome://extensions` (lub `edge://extensions`).
2. Włącz **Tryb programisty / Developer mode** (prawy górny róg).
3. Kliknij **Wczytaj rozpakowane / Load unpacked** i wskaż ten folder
   (`extension/`).
4. Przypnij ikonę rozszerzenia; kliknij ją, będąc zalogowanym na instagram.com.

## Użycie

1. Zaloguj się na Instagramie (najlepiej na koncie „do zadań specjalnych”).
2. Kliknij ikonę rozszerzenia.
3. Wpisz profil, wybierz *Obserwujący* / *Obserwowani*, ustaw limit → **Pobierz i
   skopiuj**.
4. Wklej wynik w OSINT-IG.

## Uwagi / ograniczenia

- To **scraping przez zalogowaną sesję** — przeciw regulaminowi Instagrama i
  **może skutkować ograniczeniem lub blokadą konta**. Nie używaj głównego konta,
  nie pobieraj hurtowo, rób przerwy. Pobieranie ma wbudowane opóźnienia (~0,45 s
  na stronę) i limit.
- Instagram bywa kapryśny (limity 429, zmiany API) — przy błędzie odczekaj.
- Działa dla kont, których listy są dla Ciebie widoczne (publiczne lub takie,
  które obserwujesz).
- Nie publikuj tego w Chrome Web Store bez przeglądu zgodności — to narzędzie do
  użytku własnego/OSINT na własną odpowiedzialność.
