# tile-editor

Edytor map 2D dla Androida: alternatywa dla Tiled, która działa w przeglądarce
telefonu lub tabletu, serwowana przez lokalny serwer w Termuxie. Czyta i
zapisuje pliki Tileda bez utraty danych.

Plan projektu i wszystkie decyzje: [`docs/PLAN.md`](docs/PLAN.md).

## Szybki start

```bash
npm install
npm run build
npm start examples/sokoban          # otwórz wypisany adres w przeglądarce
```

W Termuxie:

```bash
pkg install nodejs git
git clone <repo> && cd tile-editor
npm install && npm run build
termux-setup-storage                       # jednorazowo, dostęp do plików
npm start ~/storage/shared/gry/moj-projekt
```

Serwer nasłuchuje na `127.0.0.1:4173`. Żeby otworzyć edytor z innego urządzenia
w tej samej sieci — na przykład z tabletu, gdy serwer stoi na telefonie —
dodaj `--lan`.

## Co już działa

| | |
|---|---|
| **Formaty** | JSON (`.tmj` / `.tsj`) **i XML (`.tmx` / `.tsx`)**, plus `.tiled-project` |
| **Wierność zapisu** | 85 ze 110 map z `examples/` zapisuje się bajtowo identycznie; każdy kolejny zapis jest bajtowo stabilny |
| **Tilesety** | atlasy ze spacing i margin oraz kolekcje obrazków |
| **Mapy nieskończone** | odczyt i zapis chunków w obu formatach |
| **Edycja kafli** | pędzel, gumka, wypełnienie, prostokąt, pipeta, cofanie ze scalaniem pociągnięć |
| **Warstwy** | kolejność, widoczność, krycie, dodawanie i usuwanie |
| **Obiekty** | stawianie, zaznaczanie, przesuwanie ze snapowaniem, kasowanie; render z rozciąganiem, obrotem, flipem i `objectalignment` |
| **Properties** | mapy, warstwy, obiektu i kafla — wszystkie typy skalarne |
| **Lint** | sprzeczne typy property, braki względem reszty map, GID-y spoza tilesetu, nieużywane kafle |
| **Układ** | trzy progi: telefon, tablet w pionie, tablet w poziomie i desktop |
| **Gesty** | dwa palce = pan i zoom, jeden palec = narzędzie, kółko = zoom do kursora |

## Polecenia

```bash
npm start <folder>     # serwer + edytor
npm test               # złote testy round-tripu na korpusie examples/
npm run smoke          # test end-to-end w przeglądarce (wymaga playwright)
npm run typecheck
npm run dev:ui         # Vite dev server; równolegle uruchom npm start <folder>
```

## Skróty klawiszowe

`B` pędzel · `E` gumka · `F` wypełnienie · `R` prostokąt · `I` pipeta ·
`V` zaznaczanie · `A` stawianie obiektów · `G` siatka · `O` obiekty · `Ctrl+Z` / `Ctrl+Shift+Z` cofnij i
ponów · `Ctrl+S` zapisz · `Delete` usuwa zaznaczone obiekty.

Na płótnie: przeciągnięcie dwoma palcami albo `Alt` z myszą przesuwa widok,
`Alt` podczas przeciągania obiektu wyłącza snapowanie do siatki, a kliknięcie
w procent zoomu w lewym dolnym rogu dopasowuje mapę do ekranu.

## Struktura

```
packages/core     model, kodeki JSON, komendy i undo, lint, skanowanie projektu
packages/server   serwer HTTP na czystym node:http, API plikowe, SSE
packages/cli      tile-editor <folder>
packages/ui       React + PixiJS
examples/         korpus referencyjny: 110 map z dwóch gier
```

## Wierność zapisu

Edytor rozpoznaje, w jakim dialekcie JSON-a zapisany jest każdy plik — Tiled
pisze `"key":value`, a generator poziomów `"key": value` — i zapisuje go z
powrotem w tym samym. Klucze zachowują oryginalną kolejność, a pola, których
model nie rozumie, przechodzą przez zapis nietknięte.

Efekt: **zmiana jednego kafla daje diff jednej linii**, a zapis pliku, którego
się nie zmieniło, nie daje żadnego diffa.

Wyjątkiem jest 25 map, w których generator zostawił linie z samymi spacjami
wewnątrz tablic. Te zostaną raz posprzątane przy pierwszym zapisie; każdy
następny jest już bezróżnicowy.
