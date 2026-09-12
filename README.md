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
| **Tilesety** | atlasy ze spacing i margin oraz kolekcje obrazków; podłączanie, tworzenie, dodawanie obrazków jako kafli, odłączanie |
| **Animacje kafli** | edytor klatek; odtwarzanie jako przełącznik, domyślnie wyłączony |
| **Mapy nieskończone** | odczyt i zapis chunków w obu formatach |
| **Edycja kafli** | pędzel, gumka, wypełnienie, prostokąt, pipeta, cofanie ze scalaniem pociągnięć |
| **Masowa edycja** | zaznaczanie obszaru, przeciąganie zaznaczonego bloku (`Ctrl` kopiuje zamiast przenosić), kopiowanie i wycinanie, wklejanie (także między mapami), wypełnianie i czyszczenie zaznaczenia; dopóki zaznaczenie stoi, żadne narzędzie nie pisze poza nim |
| **Panel projektu** | siatka miniatur zamiast listy nazw; rysowane leniwie, po jednej, i pamiętane między sesjami — `story-11` od `story-13` odróżnia kształt, nie numer |
| **Tworzenie map** | pusta mapa albo na podstawie szablonu, z przepisaniem ścieżek do tilesetów |
| **Warstwy** | kolejność, widoczność, krycie, dodawanie i usuwanie |
| **Obiekty** | stawianie, zaznaczanie ramką, przeciąganie uchwytów do skalowania i obrotu, przesuwanie ze snapowaniem, kasowanie; render z rozciąganiem, obrotem, flipem i `objectalignment` |
| **Obiekty hurtem** | kopiowanie, wycinanie, wklejanie i duplikowanie całego zaznaczenia; properties, klasa, widoczność i obrót ustawiane wszystkim naraz, jednym cofnięciem |
| **Properties** | mapy, warstwy, obiektu i **kafla** — wszystkie typy skalarne; zmiany kafla zapisują się do tilesetu |
| **Typy własne** | enumy i klasy w `.tiled-project`; enum staje się listą wyboru, flagi checkboxami, klasa rozwija się na pola |
| **Paleta poleceń** | `Ctrl+K` — polecenia, skok do mapy i wyszukiwanie po properties w całym projekcie |
| **Lint** | sprzeczne typy property, braki względem reszty map, GID-y spoza tilesetu, nieużywane kafle, wartości spoza typu; część zgłoszeń z naprawą jednym kliknięciem |
| **Układ** | trzy progi: telefon, tablet w pionie, tablet w poziomie i desktop |
| **Gesty** | dwa palce = pan i zoom, tapnięcie dwoma palcami = cofnij, długie przytrzymanie = menu kontekstowe, kółko = zoom do kursora |
| **Odzyskiwanie pracy** | każda zmiana trafia po sekundzie do IndexedDB jako tekst, który zapisałby `Ctrl+S`; po ubiciu procesu edytor proponuje przywrócenie. Nic nie ląduje na dysku bez zapisu |
| **PWA** | manifest, ikony i service worker — instalowalne z ekranu domowego, powłoka działa offline i wraca sama, gdy serwer zniknie |

## Wydajność

`npm run bench` generuje mapy 50×50, 100×100 i 200×200 i mierzy czas
rysowania klatki. Na programowym rasteryzatorze (SwiftShader w headless
Chrome, czyli dolna granica) wychodzi **1–4 ms na klatkę przy 120 000 kafli**,
niezależnie od rozmiaru mapy — geometria kafli jest budowana raz na zmianę
dokumentu, a nie na każdy ruch kamery.

Budżet klatki na ekranie 120 Hz to 8,3 ms, więc zapas jest duży. Prawdziwy
pomiar na Galaxy Tab S7 wciąż jest do zrobienia.

## Polecenia

```bash
npm start <folder>     # serwer + edytor
npm test               # złote testy round-tripu na korpusie examples/
npm run smoke          # testy end-to-end w przeglądarce (wymaga playwright)
npm run recovery       # sam test odzyskiwania po ubiciu procesu
npm run bench          # benchmark renderera na wygenerowanych dużych mapach
npm run typecheck
npm run dev:ui         # Vite dev server; równolegle uruchom npm start <folder>
```

## Skróty klawiszowe

`B` pędzel · `E` gumka · `F` wypełnienie · `R` prostokąt · `I` pipeta ·
`S` zaznacz obszar · `V` zaznaczanie obiektów · `A` stawianie obiektów ·
`G` siatka · `O` obiekty · `P` animacje · `Ctrl+Z` / `Ctrl+Shift+Z` cofnij i
ponów · `Ctrl+S` zapisz · `Ctrl+K` paleta poleceń.

`Ctrl+C` / `Ctrl+X` / `Ctrl+V` działają na tym, co niesie aktywna warstwa:
na warstwie kafli na zaznaczonym bloku, na warstwie obiektów na zaznaczonych
obiektach. Do tego na kaflach `Ctrl+A` zaznacza całą warstwę, `Delete` czyści
zaznaczenie, `Esc` odznacza; na obiektach `Ctrl+D` duplikuje zaznaczenie,
a `Delete` je usuwa. Bez klawiatury to samo robi menu z długiego przytrzymania.

**Blok kafli przeciągasz.** Narzędziem `S` chwytasz zaznaczenie w jego środku
i przenosisz — blok idzie razem z ramką, a na starym miejscu zostaje dziura.
Z wciśniętym `Ctrl` oryginał zostaje na miejscu.

**Obiekty na płótnie.** Zaznaczony pojedynczy obiekt dostaje osiem uchwytów
skalowania i uchwyt obrotu nad górną krawędzią. Przeciągnięcie uchwytu trzyma
przeciwległy bok w miejscu, więc gest przypomina chwytanie krawędzi, a nie
przesuwanie całości — i działa tak samo na obiekcie obróconym, bo przeciągnięcie
jest odczytywane w jego własnym układzie. Rozmiar snapuje się do kafla, obrót do
15°; `Alt` wyłącza jedno i drugie. Przeciągnięcie po pustym miejscu zaznacza
ramką.

Na płótnie: przeciągnięcie dwoma palcami albo `Alt` z myszą przesuwa widok,
tapnięcie dwoma palcami cofa ostatnią zmianę, długie przytrzymanie (albo prawy
przycisk) otwiera menu kontekstowe, `Alt` podczas przeciągania obiektu wyłącza
snapowanie do siatki, a kliknięcie w procent zoomu w lewym dolnym rogu
dopasowuje mapę do ekranu.

## Wyszukiwanie w projekcie

W palecie (`Ctrl+K`) zwykły tekst filtruje polecenia i mapy, a dwa prefiksy
przeszukują cały folder:

```
#mode=versus      mapy, których property "mode" ma wartość "versus"
#seed             mapy, które w ogóle mają property "seed"
@laserColour      obiekty z tą property, w dowolnej mapie
@railId=3         obiekty o konkretnej wartości
@title~boss       dopasowanie fragmentu zamiast równości
```

Wynik otwiera mapę i zaznacza obiekt.

## Skrót na ekranie głównym

Przycisk z ikoną telefonu w pasku górnym, na lewo od pędzla. To samo polecenie
jest w palecie (`Ctrl+K` → „Dodaj do ekranu głównego").

Gdy przeglądarka aktywnie proponuje instalację, przycisk dostaje ramkę i podpis
„Dodaj skrót". Poza tym jest wyciszony, a kliknięcie mówi, co stoi na
przeszkodzie. Znika tylko tam, gdzie nie ma o czym mówić: w aplikacji natywnej
i gdy edytor już działa ze skrótu.

Działa w Chrome i Edge, na Androidzie i na desktopie. Safari i Firefox nie
udostępniają tego mechanizmu: w Safari trzeba użyć Udostępnij → Do ekranu
początkowego.

Instalacja wymaga bezpiecznego kontekstu. `127.0.0.1` się nim liczy, adres LAN
po zwykłym HTTP już nie — przy `--lan` nie będzie ani service workera, ani
instalacji.

Offline działa sama powłoka edytora. Pliki projektu czyta lokalny serwer, więc
bez niego edytor otworzy się, ale nie pokaże map — zamiast tego pokaże ekran
połączenia i **będzie próbował co trzy sekundy**. Uruchomienie serwera w
Termuxie wystarczy; edytor wróci do pracy sam.

Android ubija procesy w tle, więc serwer potrafi zniknąć po chwili poza
ekranem. Zapobiega temu `termux-wake-lock` przed uruchomieniem.

## Motywy

Cztery do wyboru — przycisk pędzla w pasku górnym albo `Ctrl+K` → „Motyw".
Wybór zapamiętuje się w przeglądarce i jest odtwarzany przed pierwszym
rysowaniem, więc nie ma mignięcia.

| Motyw | |
|---|---|
| **Monokai Pro** | ciepła fioletowa ciemność, cyjan — domyślny |
| **Gruvbox Dark** | brąz i żółć, retro |
| **Gruvbox Light** | kremowy papier, granat |
| **Piatto Light** | biel i błękit, płasko — za motywem z Sublime Text |
| **Nord** | chłodny błękitny szary |

Piatto odbiega od źródła w dwóch wartościach, obie dla kontrastu na bieli:
akcent przyciemniony z `#3498db` (biały tekst na przycisku dawał 2,7:1) i tekst
pomocniczy z `#8c8c8c` (3,4:1 na bieli).

Kolory są zapisane **wyłącznie** w `packages/ui/src/styles.css`: blok
`@theme static` opisuje domyślny, a każdy kolejny motyw to jeden blok
przestawiający te same tokeny. Płótno rysuje w WebGL i nie może użyć CSS-a, więc
`packages/ui/src/theme.ts` odczytuje te same custom properties w czasie
działania i podaje je Pixi jako liczby — warstwa WebGL i DOM nie mogą się
rozjechać. Kafelki podglądu w oknie wyboru też nie mają własnych kolorów: każdy
ustawia swoje `data-theme` i maluje się arkuszem stylów.

Dodanie motywu to jeden blok w `styles.css` i jeden wpis w `THEMES`.

`@theme static` jest tu istotne: zwykłe `@theme` wycina tokeny, których żadna
klasa Tailwinda nie używa, i po cichu ukryło `--color-shape` przed płótnem.

## Struktura

```
packages/core     model, kodeki JSON, komendy i undo, lint, skanowanie projektu
packages/server   serwer HTTP na czystym node:http, API plikowe, SSE
packages/cli      tile-editor <folder>
packages/ui       React + PixiJS
examples/         korpus referencyjny: 115 map z trzech gier
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
