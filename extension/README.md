# OSINT-IG Collector — rozszerzenie Chrome / Edge

## Instalacja lub aktualizacja

1. Otwórz chrome://extensions lub edge://extensions i włącz tryb programisty.
2. Wybierz „Wczytaj rozpakowane” i wskaż folder extension/.
3. Jeśli rozszerzenie jest już zainstalowane, kliknij jego przycisk odświeżenia.
   Wersja 0.3.1 wymaga uprawnienia do lokalnego adresu 127.0.0.1.

## Połączenie jednym kliknięciem

1. Uruchom aktualną aplikację OSINT-IG (desktop lub web).
2. Zaloguj się na instagram.com w przeglądarce z rozszerzeniem.
3. Kliknij ikonę rozszerzenia → **Połącz z aplikacją OSINT-IG**.

Aplikacja odbierze sesję, przejdzie do widoku Sesja IG i sprawdzi konto na
Instagramie. Rozszerzenie pokaże „Połączono” dopiero po udanej weryfikacji.
Wersja 0.3.1 sprawdza konto zapytaniem web viewer, ponieważ stary endpoint
accounts/current_user może przekierowywać do HTML mimo poprawnej sesji.
Nie trzeba kopiować ciasteczek ani wklejać ich ręcznie. Jeżeli Instagram odrzuci
sesję, szczegóły są w aplikacji. Uruchom tylko jedną instancję OSINT-IG.

Połączenie używa wyłącznie lokalnego adresu 127.0.0.1:17654. Działa również
z losowym portem silnika desktopowego. Paczka ciasteczek jest przechowywana
w pamięci silnika najwyżej 60 sekund i usuwana zaraz po odbiorze przez aplikację;
nie trafia do logów ani plików silnika. Aplikacja zapisuje sesję lokalnie jak przy
ręcznym imporcie. „Odłącz i usuń” w aplikacji usuwa zapisane ciasteczka.

Opcja **Kopiuj ciasteczka (ręcznie)** pozostaje dostępna do importu przez schowek.

## Pobieranie list

Podaj profil, wybierz Obserwujący / Obserwowani i limit, a następnie kliknij
„Pobierz listę i skopiuj”. Wklej listę w aplikacji w widoku sieci.
Zapytania idą z przeglądarki do Instagrama z Twoją sesją.

Instagram może ograniczyć lub zablokować konto przy scrapingu; używaj konta
pomocniczego, nie pobieraj hurtowo i rób przerwy. Dostępne są tylko listy,
które to konto może zobaczyć. Rozszerzenie nie omija ograniczeń Instagrama.
