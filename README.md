# OSINT-IG — porównywarka profili Instagram

Prosta strona (czysty HTML/CSS/JS, bez backendu) do zestawiania dwóch profili
Instagram obok siebie i porównywania ich statystyk: obserwujący, obserwowani,
liczba postów oraz ratio (obserwujący ÷ obserwowani). Metryka, w której dany
profil wygrywa, jest podświetlana na zielono (▲).

## Jak uruchomić

To statyczna strona — wystarczy dowolny serwer HTTP:

```bash
# Python
python3 -m http.server 8000
# potem otwórz http://localhost:8000
```

Otwarcie `index.html` bezpośrednio z pliku (`file://`) też działa, ale serwer
HTTP jest pewniejszy dla zapytań sieciowych.

## Skąd biorą się dane

Instagram blokuje zapytania cross-origin (CORS) i nie ma darmowego publicznego
API, więc dane publicznego profilu próbujemy pobrać z endpointu
`web_profile_info` przez kilka publicznych **CORS-proxy** (po kolei, aż któreś
zadziała).

To rozwiązanie **best-effort** — proxy bywają zawodne, a Instagram często
odpowiada stroną logowania zamiast danymi. Dlatego gdy automatyczne pobranie
się nie uda, karta profilu przechodzi w **tryb ręczny**: pola statystyk stają
się edytowalne i możesz wpisać wartości samodzielnie (np. odczytane z profilu).
Porównanie i podświetlenie zwycięzcy aktualizują się na żywo podczas edycji.

## Pliki

| Plik         | Rola                                          |
|--------------|-----------------------------------------------|
| `index.html` | struktura strony                              |
| `styles.css` | wygląd (ciemny motyw)                          |
| `app.js`     | pobieranie danych, fallback ręczny, porównanie |

## Uwagi / ograniczenia

- Działa tylko dla **profili publicznych**; przy prywatnych IG nie udostępnia
  statystyk.
- Publiczne CORS-proxy mogą przestać działać w dowolnym momencie — wtedy
  zostaje tryb ręczny. Własny mały serwer-proxy (np. w Node/Express) dałby
  stabilniejsze pobieranie, ale wymaga backendu.
- Korzystaj zgodnie z [regulaminem Instagrama](https://help.instagram.com/581066165581870)
  i obowiązującym prawem.
