# Pochodzenie danych — rejestr PESEL

Pliki `imiona_meskie.csv` i `imiona_zenskie.csv` to **wykaz imion pierwszych
osób żyjących** w rejestrze PESEL (bez zgonów), stan na **2021-02-04**.

- **Format:** `IMIĘ_PIERWSZE,PŁEĆ,LICZBA_WYSTĄPIEŃ`
- **Liczba imion:** ~46 tys. męskich, ~29 tys. żeńskich (łącznie z rzadkimi i
  obcymi).
- **Wydawca / źródło:** Ministerstwo Cyfryzacji, portal otwartych danych
  <https://dane.gov.pl> — zbiór „Lista imion występujących w rejestrze PESEL”.
  Oryginalny zasób CSV:
  `https://api.dane.gov.pl/media/resources/20210204/Wykaz_imion_*_osób_żyjących_...rejestrze_PESEL_bez_zgonów.csv`
- **Licencja:** dane publiczne udostępniane na portalu dane.gov.pl (otwarte dane
  administracji publicznej).

Pliki są trzymane w repozytorium, bo środowisko budujące nie ma dostępu do
dane.gov.pl, a chcemy, by `npm run build:names` było w pełni odtwarzalne.
Są one **wyłącznie źródłem build-time** dla `api/build-names.mjs`; w czasie
działania aplikacji używany jest tylko wygenerowany `api/names-data.json`.
