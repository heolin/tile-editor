# Tile Editor — plan projektu

Nowoczesna alternatywa dla Tiled: edytor map 2D działający w przeglądarce,
z pierwszorzędnym wsparciem dla Androida/Termuxa, pełną obsługą TMX
i wydaniem jako PWA.

Status: planowanie. Data: 2026-09-09.

---

## 1. Cel

Edytor map do gier 2D, który:

- działa na telefonie z Androidem uruchomiony z Termuxa (to główny target, nie dodatek),
- czyta i zapisuje pliki Tileda w **obu formatach** — JSON (`.tmj`/`.tsj`) i XML
  (`.tmx`/`.tsx`/`.tx`) — bez utraty danych, w obie strony,
- rozumie **projekt** = folder z mapami, które współdzielą tilesety i grafiki,
- pozwala tworzyć mapy, warstwy, obiekty i properties,
- wygląda i działa jak narzędzie zaprojektowane w latach 20., nie w 2008,
- da się zainstalować jako PWA i skrót na ekranie głównym.

## 2. Ograniczenia, które kształtują architekturę

| Ograniczenie | Konsekwencja projektowa |
|---|---|
| Brak Electrona i realnego Android SDK w Termuxie | Dystrybucja przez PWA, a nie natywny pakiet — nic do zbudowania na urządzeniu |
| Chrome Android nie udostępnia `showDirectoryPicker` | Przeglądarka nie dosięgnie folderu projektu — dostęp do plików daje lokalny serwer Node |
| `node-gyp` / moduły natywne zawodne na aarch64 | Wyłącznie zależności pure-JS. Zero binarek w ścieżce krytycznej |
| Android ubija procesy w tle | Serwer startuje jednym poleceniem, wstaje w <1s, stan trzymany w plikach |
| Brak hovera i prawego przycisku przy dotyku | Touch-first to wymaganie funkcjonalne, nie warstwa kosmetyczna |
| Ograniczona bateria i GPU | Render-on-demand — brak stałej pętli rAF, rysujemy tylko przy zmianie |
| Docelowe urządzenie: Galaxy Tab S7 (~1280×800 CSS px, dotyk + S Pen, 120 Hz) | Układ panelowy przy dotykowym wejściu — szerokość ekranu i rodzaj wskaźnika to **dwie niezależne osie** |

**Model wdrożenia:** lokalny serwer Node w Termuxie serwuje SPA i wystawia API
plikowe; przeglądarka daje UI i dostęp do GPU. To nie jest aplikacja webowa
w chmurze — to lokalne narzędzie z webowym frontendem.

## 3. Decyzje

| Obszar | Wybór | Uzasadnienie |
|---|---|---|
| Renderer | **PixiJS v8 + `@pixi/tilemap` 5** | Batchowany rendering kafli w WebGL, render-on-demand, działa na GPU telefonu. Canvasowy fallback tilemapy jest ~5× wolniejszy — WebGL jest tu obowiązkowy. Za interfejsem `TileRenderer`, więc własny shader pozostaje opcją na później |
| UI | **shadcn/ui + Tailwind v4 + Radix** | Komponenty żyją w repo, więc touch targety i design są w pełni pod kontrolą. Najwyższy sufit wizualny |
| Format projektu | **Kompatybilny z `.tiled-project`** | Dwustronna interoperacyjność: ten sam folder otwiera się w Tiled na desktopie. Nasze rozszerzenia w osobnym pliku obok |
| Formaty | **TMJ/TSJ w M0, TMX/TSX w M1** | Cały korpus (110 map) jest w JSON — tylko na nim da się testować na prawdziwych danych. TMX dochodzi zaraz po, bo bez niego nie ma mowy o alternatywie dla Tileda |
| Zakres v1 | **Kafle + warstwy + obiekty + properties + lint** | Otwórz projekt → maluj → stawiaj obiekty → sprawdź lintem → zapisz. Bez autotilingu i edytora tilesetów |
| Stan | Zustand + Immer (UI), własny stos komend (dokument) | Undo musi być semantyczne (`PaintTiles`, `AddObject`), nie generycznym diffem stanu |
| Język | TypeScript, strict | — |

**Świadomie odrzucone:**

- **Phaser** — silnik gry, nie fundament edytora. Własny game loop i model
  inputu walczą z precyzyjnym pan/zoom i overlayami zaznaczenia; stała pętla
  rAF grzeje telefon. Może wrócić później, w odizolowanym trybie „play test".
- **React Native** — brak dostępu do dojrzałego renderera 2D i całego
  ekosystemu web; nie rozwiązuje żadnego z problemów, a odcina target webowy.
- **Electron / Tauri** — nie uruchomią się w Termuxie.
- **Własny renderer WebGL2 na start** — szybszy i mniejszy, ale opóźnia
  pierwszy widoczny kafel o 2-3 tygodnie. Wraca jako optymalizacja w M6.

## 4. Architektura

```
packages/
  core/        model dokumentu, TMX/TSX/TX parse+serialize, komendy, undo — zero DOM
  renderer/    interfejs TileRenderer + implementacja PixiJS
  ui/          React SPA (Vite) — cały interfejs
  server/      node:http: statyki + API plikowe + SSE. To działa w Termuxie
  cli/         `npx tile-editor .` — startuje serwer, drukuje URL
```

### 4.1. `ProjectFS` — kluczowa abstrakcja

Jeden interfejs (`list`, `read`, `write`, `watch`, `resolve`, `stat`)
z trzema implementacjami:

| Adapter | Target | Mechanizm |
|---|---|---|
| `HttpProjectFS` | **Termux (główny)** | REST + SSE do serwera Fastify |
| `FsaProjectFS` | Desktop Chrome bez serwera | File System Access API |
| `MemoryProjectFS` | Testy, demo online | W pamięci, seed z ZIP-a |

To ta jedna abstrakcja sprawia, że web i Termux to ten sam kod. Nic
powyżej `ProjectFS` nie wie, skąd biorą się pliki.

### 4.2. Zależności runtime (wszystkie pure-JS)

`pixi.js` 8.20 · `@pixi/tilemap` 5.0 · `fast-xml-parser` 5.11 ·
`fflate` 0.8 (gzip/zlib) · `fzstd` 0.1 (dekompresja zstd) ·
`zustand` 5 · `lucide-react` (ikony) · `tailwindcss` 4

**Odstępstwo od planu:** serwer stoi na czystym `node:http`, nie na Fastify.
Zero zależności znaczy zero ryzyka instalacji w Termuxie i start poniżej
sekundy — a API plikowe to sześć tras, na których framework nic nie wnosi.
`dockview` i `vaul` też odpadły: układ z trzema progami i bottom sheet okazały
się krótsze napisane wprost niż skonfigurowane.

## 5. Korpus, model danych i formaty

### 5.1. Co naprawdę jest w `examples/`

Przeanalizowane 9 września 2026: **110 map, 2 tilesety, 250 PNG-ów, dwa
projekty** (`sokoban`, `tilt-ball`). To jest referencja, względem której
mierzymy zakres — nie wyobrażenia o tym, co edytor map „powinien" umieć.

| Obserwacja | Liczba | Konsekwencja |
|---|---|---|
| Plików TMX w korpusie | **0** | Wszystko to `.tmj`/`.tsj`. Priorytet formatów odwrócony: JSON pierwszy |
| Rozmiary map | 5×6 … **16×20** | Jeszcze mniejsze niż deklarowane 50×50. Chunkowanie ostatecznie odpada |
| Typy warstw | `tilelayer` 316, `objectgroup` 31 | Zero grup, imagelayerów, offsetów, parallaxu, tintu, ukrytych warstw, opacity ≠ 1 |
| Obiekty | **712, wszystkie kaflowe** | Ani jednego prostokąta, elipsy, punktu, poligonu, polilinii, tekstu |
| Obiekty rozciągnięte poza natywny kafel | **655 / 712** | To jest realna treść M3, nie przypadek brzegowy |
| Obiekty obrócone o 90/180/270° | 171 / 712 | — |
| Obiekty z flipem poziomym | 9 | Flagi flipów używane, ale tylko na obiektach |
| `objectalignment` | `"center"` w tilt-ball | Zmienia matematykę kotwicy dla wszystkich 712 obiektów |
| Tilesety | kolekcje obrazków, `columns: 0` | Nie atlasy. 31 i 55 osobnych PNG-ów |
| Obiekty z ustawionym `class`/`type` | **0** | Cała semantyka gry siedzi w properties |
| `propertyTypes` w `.tiled-project` | `[]` w obu | Custom types jeszcze nieużywane |
| Kompresja danych warstw | brak, gołe tablice JSON | Gałąź base64/gzip/zlib/zstd schodzi z krytycznej ścieżki |
| Animacje kafli, kolizje kafla, `.tx` | brak | Spadają do v1.1 bez straty |

**Najważniejszy wniosek:** rdzeniem produktu jest **edytor properties** —
mapy, obiektu i **kafla w tilesecie**. Logika obu gier czyta `kind`, `colour`,
`lock`, `laserColour`, `bouncy`, `rotates` z kafli oraz `railId`,
`laserColour`, `direction`, `rotatePeriod` z obiektów. Nic z tego nie jest
opisane klasami; wszystko to luźne properties.

**Drugi wniosek:** obiekt kaflowy — rozciągnięty, obrócony, czasem odbity,
wyrównany do środka — to najtrudniejszy detal renderowania w korpusie
i jedyny kształt obiektu, który realnie występuje.

### 5.2. Błędy znalezione w korpusie

Znalazł je skrypt analityczny w kilka sekund — najlepszy argument za
przesunięciem lintu do v1:

- **`railId` ma dwa typy** — `int` w 56 obiektach, `string` w 18.
- `solution`, `seed` i `metrics` brakuje w 10 z 78 map sokobana (wszystkich `_coop`).
- 14 z 31 kafli sokobana i 10 z 55 tilt-balla nie jest używanych w żadnej mapie.
- `template.tmj` w obu grach to ręczna konwencja, nie mechanizm Tileda —
  „nowa mapa z szablonu" obsłuży to wprost.

### 5.3. Reprezentacja w pamięci

- Warstwa kafli to płaska `Uint32Array`: GID w dolnych bitach, flagi flipów
  (H/V/D) w górnych — identycznie w obu formatach. **Nigdy tablice obiektów.**
- `LayerData` jest interfejsem od M0 (`get`, `set`, `bounds`, `iterate`),
  z jedyną implementacją `DenseLayerData`. Dołożenie `ChunkedLayerData`,
  gdy mapy urosną, nie dotknie narzędzi ani renderera.
- Obiekty i properties jako zwykłe struktury TS — jest ich mało, wygoda wygrywa.
- **Model jest niezależny od formatu.** Rdzeń zna tylko `TileMap`, `Tileset`,
  `Layer`, `MapObject`, `Property`. Formaty to dwa kodeki po bokach:
  `JsonCodec` (M0) i `XmlCodec` (M1), oba implementujące ten sam interfejs
  `MapCodec { read(bytes): TileMap; write(map): bytes }`.

### 5.4. Zakres wsparcia formatów

**v1, weryfikowalne na korpusie:** `map` ortogonalna · tileset zewnętrzny,
w tym **kolekcja obrazków** (`columns: 0`) · `tilelayer` z danymi jako tablica ·
`objectgroup` · **obiekt kaflowy z rozciąganiem, rotacją, flipem
i `objectalignment`** · properties mapy, warstwy, obiektu i **kafla** we
wszystkich typach skalarnych · `.tiled-project` z `folders`.

**v1, wymagane dla interoperacyjności, ale nieobecne w korpusie:** pozostałe
kształty obiektów · tileset atlasowy · `data` w base64 z gzip/zlib ·
`imagelayer` · `group` · opacity, visible, offset, parallax, tintcolor.
Bez tego edytor nie otworzy cudzych map, ale nie da się tego zweryfikować
na Waszych plikach — stąd osobna pozycja w rejestrze ryzyk.

**v1.1:** ~~`animation`~~ (M4) · ~~custom types (`propertyTypes`)~~ (zrobione) ·
kolizje kafla — dane przechodzą przez zapis, brakuje edytora kształtów ·
szablony `.tx` · zstd.

**Zrealizowane wcześniej niż planowano:** mapy nieskończone i chunki —
w korpusie ich nie ma, ale przykładowa mapa Tileda na nich stanęła, a odczyt
pliku, którego edytor nie rozumie, oznaczałby utratę danych przy zapisie.
Odczyt i zapis chunków działa w obu formatach.

**Później:** orientacja izometryczna i heksagonalna (czytane, ale rysowane
jak ortogonalne) · `wangsets` (wracają z autotilingiem w M6) · `.world`.

### 5.5. Wierność round-tripu — zrealizowane inaczej niż zakładano

**Korekta wobec pierwotnego planu.** Zakładałem asercję „bajtowo zgodne
z wejściem". Po zmierzeniu korpusu okazało się, że **nie ma jednego formatu do
odtworzenia**: 31 ze 110 plików ma wewnątrz siebie więcej niż jeden styl
separatora, 11 kończy się znakiem nowej linii a 99 nie, 25 zawiera linie
z samymi spacjami. Pliki pisał mix Tileda i generatora poziomów.

Cel został więc przeformułowany na mocniejszy i wykonalny: **rozpoznanie
dialektu i stabilność**. Kodek wykrywa, czy plik pisał Tiled (`"key":value`)
czy zwykły serializer (`"key": value`), i zapisuje go w tym samym dialekcie.
Wynik: **85 ze 110 map zapisuje się bajtowo identycznie**, a pozostałe 25
różnią się wyłącznie liniami z samymi spacjami, które pierwszy zapis sprząta
raz na zawsze. Każdy kolejny zapis jest bajtowo stabilny.

Zmierzone na żywo: zmiana jednego kafla daje diff jednej linii i jednego tokenu.

### 5.6. Mechanika round-tripu

Kodeki zachowują nieznane pola i odtwarzają je przy zapisie, serializacja jest
deterministyczna, a **złote testy** asertują `read → write` bajtowo zgodne na
**wszystkich 110 mapach z `examples/`**, poza zamkniętą listą dozwolonych
normalizacji. Ten test powstaje w M0, przed jakimkolwiek UI.

## 6. Projekt = folder

Czytamy i piszemy `.tiled-project` Tileda. Nasze rozszerzenia (reguły
autotilingu, zapisane brushe, układ paneli) trafiają do osobnego pliku
`.tmproj` obok — Tiled go ignoruje, my go czytamy.

Projekt daje: skanowanie folderów w poszukiwaniu map (`*.tmx`) i tilesetów
(`*.tsx`), współdzieloną bibliotekę tilesetów z miniaturami, wspólne custom
types i szablony obiektów, ustawienia per-projekt (siatka, snapping, domyślny
rozmiar kafla), listę ostatnich map.

## 7. UI/UX

Szerokość ekranu i rodzaj wskaźnika to **dwie niezależne osie**, nie jedna.
Galaxy Tab S7 jest tego dowodem: ~1280×800 CSS px w poziomie, więc należy mu
się układ panelowy jak desktopowi, ale wejście ma dotykowe. Założenie
„szeroki ekran = mysz" byłoby tu błędem.

### 7.1. Oś szerokości

| Zakres | Urządzenie | Układ |
|---|---|---|
| compact, <768 px | telefon | Płótno na pełnym ekranie, reszta w bottom sheetach z dolnego paska |
| medium, 768–1180 px | **Tab S7 w pionie** | Panele dokowane, boczne rale zwinięte do ikon |
| wide, >1180 px | **Tab S7 w poziomie**, desktop | Panele dokowane, rale rozwinięte |

Trójstopniowość istnieje po to, żeby **obrót tabletu nie przełączał układu**,
tylko zwijał rale. Przeskok panele ↔ arkusze przy obrocie byłby dezorientujący.

### 7.2. Oś wskaźnika

Sterowana `@media (pointer: coarse|fine)` plus `pointerType` z Pointer Events —
bo na Tab S7 obie wartości występują na tym samym ekranie, zależnie od tego,
czy użytkownik sięgnął palcem czy rysikiem.

- **coarse (palec):** minimalny target 44 px, zero UI zależnego od hovera,
  menu kontekstowe przez long-press, powiększone uchwyty przeciągania.
- **fine (mysz, S Pen):** gęstsze kontrolki, hover, tooltipy, prawy przycisk.

**S Pen to realny atut, nie ciekawostka.** Tab S7 ma go w zestawie, a Pointer
Events raportują `pointerType: "pen"` z osobnym hoverem i naciskiem. Rysik daje
precyzję pojedynczego kafla, której palec nie da: podgląd pędzla pod
zawieszonym rysikiem i nacisk mapowany na rozmiar pędzla to funkcje, których
Tiled na desktopie nie ma. Do zweryfikowania na urządzeniu w M1.

### 7.3. Gesty i reszta

**Dotyk:** dwa palce = pan i zoom jednocześnie · jeden palec = aktywne
narzędzie · long-press = menu kontekstowe · tap dwoma palcami = undo.

**Wspólne:** command palette (`Ctrl+K` lub przycisk), pełna obsługa klawiatury,
ciemny motyw domyślnie.

**120 Hz.** Ekran Tab S7 podnosi poprzeczkę płynności pan/zoom: budżet klatki
to ~8 ms, nie 16 ms. Render-on-demand tym bardziej się opłaca — nie rysujemy
nic, gdy nic się nie zmienia, a gdy się zmienia, mamy połowę zwykłego czasu.

## 8. Milestones

Każdy kończy się czymś, co da się uruchomić na telefonie.

| M | Zakres | Deliverable | Stan |
|---|---|---|---|
| **M0** | Szkielet monorepo, model niezależny od formatu, **`JsonCodec` (TMJ/TSJ)**, złote testy round-tripu na 110 mapach z `examples/`, `ProjectFS` + adapter HTTP, serwer HTTP, CLI | `npx tile-editor .` startuje w Termuxie; round-trip zielony na całym korpusie | **gotowe** |
| **M1** | **`XmlCodec` (TMX/TSX)**, `TileRenderer` na Pixi, pan/zoom, siatka, warstwy kafli i obiekty kaflowe read-only, tilesety-kolekcje, drzewo projektu | Otwierasz sokobana i tilt-balla na Tab S7 i płynnie po nich nawigujesz | **gotowe** |
| **M2** | Narzędzia: pędzel, gumka, wypełnienie, prostokąt, pipeta, zaznaczenie. Panel warstw (kolejność, widoczność, opacity). Stos undo/redo. Zapis | Pełna pętla edycji kafli i zapis | **gotowe** |
| **M3** | Obiekty kaflowe: stawianie, przesuwanie, **rozciąganie, obrót, flip, `objectalignment`**. Pozostałe kształty. Edytor properties mapy, warstwy, obiektu i kafla. **Lint** — sprzeczne typy property, braki względem reszty map, GID-y spoza tilesetu, nieużywane kafle | **v1** | **gotowe** |
| **M4** | Menedżer tilesetów, import grafik, edytor tilesetu (kolizje, animacje), mapy nieskończone | Praca z tilesetami bez wychodzenia do Tileda | **gotowe poza kolizjami kafla** |
| **M5** | Dopracowanie mobile UX, PWA (installable, offline), wydajność na słabszych telefonach | Instalowalne z ekranu domowego, działa offline | **gotowe** |
| **M6** | Autotiling (Wang sets + reguły w stylu LDtk), command palette, wyszukiwanie w projekcie, lint mapy | Funkcje, których Tiled nie ma albo ma gorsze | lint, paleta i wyszukiwanie gotowe; autotiling odłożony |
| **M7** | Capacitor 7, `CapacitorProjectFS` przez SAF, pipeline APK w GitHub Actions | Podpisany APK do pobrania z Actions | **wycofane** — patrz niżej |
| **M8** | Masowa edycja kafli: zaznaczanie obszaru, schowek, zaznaczenie jako maska narzędzi | Blok kafli przenosi się w obrębie mapy i między mapami | **gotowe** |
| **M13** | Właściwości w osobnej kolumnie, ustawienia mapy w oknie, reakcja na zmianę rozmiaru | Widać, co się edytuje, i zmiana rozmiaru jest widoczna | **gotowe** |
| **M12** | Zmiana property w całym projekcie: nazwa, typ, usunięcie — z podglądem | `railId` → `rail_id` w 115 mapach to jedna operacja, nie `sed` | **gotowe** |
| **M11** | Miniatury map w panelu projektu, rysowane leniwie i cache'owane w IndexedDB | Mapę wybiera się po wyglądzie, nie po numerze | **gotowe** |
| **M10** | Odzyskiwanie niezapisanej pracy: szkic w IndexedDB, propozycja przywrócenia przy starcie | Ubicie procesu nie kosztuje pracy | **gotowe** |
| **M9** | Masowa edycja obiektów: schowek obiektów, duplikowanie, properties całego zaznaczenia | Poprawka na 40 obiektach to jedna operacja, nie 40 | **gotowe** |

### M13 — panel właściwości przebudowany, 12 września 2026

Z testów na żywo wyszły dwie rzeczy, obie moje błędy projektowe.

**Zmiana rozmiaru mapy wyglądała, jakby nic nie robiła.** Dane były poprawne —
warstwy rosły, można było malować po nowym obszarze — ale kamera zostawała
w miejscu, więc nowe krawędzie lądowały poza ekranem, a pusty obszar rysował
się **czarną** siatką na prawie czarnym tle. Teraz widok przekadrowuje się na
całą mapę (`fitToMap()`), leci potwierdzenie „Mapa ma teraz 20 × 14 kafli",
a siatka rysuje się kolorem `ink`, nie czarnym — bo właśnie w pustym obszarze
jest jedyną rzeczą, w którą można celować.

**Panel properties był jednym oknem o niewidocznym celu.** Przełączał się
w milczeniu między mapą, warstwą, obiektem i kaflem, a otwarcie tilesetu
kasowało go z ekranu. Rozbicie:

- **Właściwości mają własną kolumnę po prawej** od 1180 px w górę — czyli na
  Tab S7 w poziomie. Zostają na miejscu, kiedy po lewej otwierasz projekt albo
  tileset. Poniżej tego progu dwie kolumny zostawiłyby ~300 px płótna, więc
  tam panel dalej jest jeden.
- **Mapa dostała własne okno**, otwierane nazwą mapy w pasku górnym — bo mapa
  nie jest zaznaczeniem, a jest tym, do czego chce się sięgnąć, patrząc na coś
  innego. Rozmiar, orientacja, format i properties mapy siedzą tam.
- **Przełącznik celu** na górze panelu nazywa to, co edytujesz (`objects`,
  `obiekt #52`, `kafel #12`) i pozwala wrócić. Wcześniej trzeba było zgadywać
  z tytułu panelu.

### M12 — property w całym projekcie, 12 września 2026

Cała semantyka tych gier siedzi w properties rozsypanych po 115 plikach, które
łączy tylko konwencja. Zmiana nazwy jednej z nich była do tej pory operacją na
`sed`zie z nadzieją, że nie trafi w string w kodzie.

Policzone przy okazji, i to przestawiło zakres: w korpusie jest **579 properties
mapy, 199 kafla, 89 obiektu i ani jednej warstwy**. Kafle to drugi co do
wielkości zakres — a indeks properties w ogóle ich nie znał, przez co
podpowiedzi nazw przy właściwościach kafla były zawsze puste. `indexProperties`
przyjmuje teraz tilesety, a `indexScope` w panelu przestało mapować kafel na
warstwę.

Operacja jest w `core/refactor.ts` (liczenie osobno od stosowania, żeby podgląd
niczego nie dotykał) i ma trzy zabezpieczenia, bo jako jedyna w edytorze
przepisuje pliki, których użytkownik nigdy nie otworzył, i **nie da się jej
cofnąć jednym `Ctrl+Z`**:

- `Zastosuj` jest martwe, dopóki nie zobaczysz podglądu — z liczbą wystąpień
  i rozbiciem na pliki;
- zakresy są rozdzielone, więc `railId` na obiekcie i `railId` na kaflu to dwie
  osobne pozycje na liście, a nie jedna pułapka;
- przy niezapisanej otwartej mapie odmawia startu.

Przeliczanie typu jest celowo tępe: co się nie konwertuje, staje się wartością
pustą typu, a nie zgadywanym odpowiednikiem — błąd ma wyglądać na błąd.

### M11 — miniatury map, 12 września 2026

115 poziomów nazwanych `story-01`…`story-40` nie da się odróżnić po nazwie.
Panel projektu rysuje je teraz małe, w siatce (lista została pod przełącznikiem
i zapamiętuje wybór).

Decyzje, które to ukształtowały:

- **Płaskie płótno 2D, nie Pixi.** Renderer WebGL trzyma mapę, którą się
  edytuje; walka o kontekst dla kilkudziesięciu miniatur nie ma sensu, a
  `drawImage` z `TileSourceIndex` wystarcza w zupełności.
- **Obiekty rysują się razem z kaflami.** Poziom tilt-balla to same obiekty —
  miniatura bez nich byłaby pustym prostokątem. Kotwica z `objectalignment`
  i obrót są respektowane, inaczej każdy obiekt siedziałby o własny rozmiar
  obok.
- **Leniwie i po jednej.** `IntersectionObserver` zamawia miniaturę dopiero,
  gdy kafelek zbliża się do ekranu, a kolejka rysuje po jednej — inaczej
  otwarcie panelu ściągałoby 115 map naraz. Margines 400 px nie jest ozdobą:
  bez niego szybkie przewinięcie wynosiło kafelek poza ekran, zanim doszła
  pierwsza odpowiedź obserwatora, i taka miniatura nie rysowała się nigdy.
  Nieudane rysowanie ponawia się, zamiast zostawiać dziurę w siatce.
- **Klucz cache zawiera czas modyfikacji pliku.** `scanProject` zwraca teraz
  `stamps`, więc zmieniona mapa to zwykłe pudło w cache, a nie nieaktualny
  obrazek. Stare klucze sprząta `pruneThumbs()` przy starcie.

Zmierzone na sokobanie (79 map, SwiftShader): pierwsze przewinięcie panelu
rysuje komplet w **2,7 s**, a po przeładowaniu strony wszystkie 79 wraca
z IndexedDB, pobierając z serwera **jedną** mapę — tę otwartą w edytorze.

### M10 — odzyskiwanie niezapisanej pracy, 11 września 2026

Plan od początku zapisywał ryzyko „Termux ubija serwer w tle" z mitygacją
„stan zawsze w plikach". To była nieprawda: stan siedział w pamięci do
`Ctrl+S`, a jedynym zabezpieczeniem było `beforeunload`, które przy zabiciu
procesu przez Androida nie ma prawa się odpalić. Na docelowym urządzeniu to był
najczęstszy sposób utraty pracy.

Teraz każda zmiana po 1,5 s trafia do IndexedDB jako **dokładnie ten tekst,
który zapisałby `Ctrl+S`** — razem z tekstem, jaki plik miał w chwili otwarcia,
i z brudnymi tilesetami. Dzięki temu przywrócenie to `adoptMap()`, czyli ta sama
ścieżka co zwykłe wczytanie, tylko bez czytania pliku; złote testy round-tripu
obejmują ją bez zmian. Szkic leci też na `visibilitychange`, bo zwinięcie
przeglądarki na Androidzie to pierwszy krok do zabicia jej procesu.

Dwie decyzje warte zapisania:

- **Przywrócenie nie dotyka dysku.** Wkłada zmiany do edytora jako niezapisane;
  plik zmienia dopiero `Ctrl+S` użytkownika. Dialog mówi to wprost i ostrzega,
  gdy plik na dysku zmienił się od czasu szkicu.
- **Przełączenie mapy nie gubi już pracy po cichu.** Wcześniej `openMap`
  czyścił historię i podmieniał dokument bez słowa. Teraz najpierw odkłada
  szkic i mówi, gdzie go szukać („Niezapisane zmiany…" w palecie poleceń).

Testu na to nie da się napisać w jednej karcie, więc `scripts/recovery.mjs`
trzyma jeden kontekst przeglądarki, zabija stronę w połowie edycji i sprawdza
cały cykl. `npm run smoke` uruchamia go jako trzeci przebieg.

### M9 — masowa edycja obiektów, 11 września 2026

To samo, co M8 zrobiło dla kafli, dla obiektów — bo tam, a nie w kaflach,
siedzi cała semantyka tych gier (§5.1, 712 obiektów w tilt-ballu).

`Ctrl+C` / `Ctrl+X` / `Ctrl+V` nie są dwoma osobnymi poleceniami: wybierają
schowek po rodzaju aktywnej warstwy. `Ctrl+D` duplikuje zaznaczenie o kafel
w prawo i w dół, menu kontekstowe robi to samo palcem, a naciśnięcie na obiekt
należący do zaznaczenia działa na całym zaznaczeniu, nie na tym jednym.

Przy zaznaczeniu większym niż jeden obiekt panel properties zamienia się
w edytor zbiorczy: pokazuje sumę nazw properties ze wszystkich zaznaczonych
obiektów, przy każdej `19/19` albo `12/19` i ostrzeżenie, gdy wartości się
różnią. Zapis idzie do **wszystkich**, dopisując property tam, gdzie jej nie
było — bo o to chodzi w poprawce hurtem. Cała sesja edycji w tym panelu to
jedno cofnięcie, tak samo jak przy jednym węźle.

Dwie rzeczy wyszły dopiero z testu end-to-end w przeglądarce:
`AddObjectCommand` nie cofał `nextobjectid`, więc cofnięte wklejenie zostawiało
ślad w zapisanym pliku; a przełączenie panelu między jednym a wieloma obiektami
zmieniało liczbę hooków w komponencie i wywracało cały interfejs (React #310).
Dlatego `npm run smoke` chodzi teraz po dwóch projektach: sokoban ma same
warstwy kafli, tilt-ball same obiekty.

### M8 — masowa edycja kafli, 11 września 2026

Narzędzie `S` wyciąga prostokąt zaznaczenia na warstwie kafli. Zaznaczenie
żyje dalej po puszczeniu palca i robi dwie rzeczy naraz:

- jest źródłem bloku — `Ctrl+C` / `Ctrl+X` bierze go do schowka **i na pędzel**,
  więc od razu można nim stemplować; `Ctrl+V` kładzie blok w miejscu
  zaznaczenia, a menu z długiego przytrzymania kładzie go pod palcem;
- jest maską — dopóki stoi, pędzel, gumka, wypełnienie i prostokąt piszą tylko
  w jego środku. Maska siedzi w `SetTilesCommand`, nie w narzędziach, więc nie
  da się o niej zapomnieć w nowym narzędziu.

Zaznaczenie jest też uchwytem: naciśnięcie w jego środku bierze blok i przenosi
go razem z ramką, zostawiając dziurę (z `Ctrl` — kopię). Podczas przeciągania
kafle naprawdę siedzą na warstwie, więc podgląd jest za darmo i dokładny, ale
do historii trafia dopiero miejsce, w którym blok puszczono. Robi to
`MoveTilesCommand`, przemierzany w locie przez `setDelta()` — jeden gest to
jedna komenda, a nie czterdzieści.

Schowek przeżywa otwarcie innej mapy, bo przeniesienie fragmentu z mapy na mapę
to połowa powodu, dla którego istnieje. Samo zaznaczenie nie przeżywa.

Ryzyko, które to niesie: zaznaczenie, o którym użytkownik zapomniał, wygląda
jak zepsuty pędzel. Dlatego jest rysowane kreskowaną ramką na ciemnym podkładzie
(widoczną też na jasnym tilesecie), a w HUD stoi `⬚ 4×3 ×`, które odznacza
jednym kliknięciem.

Operacje na kaflach przeniosły się przy okazji z UI do `core/tiles.ts` i dostały
testy. Wyszły z tego dwa błędy: `floodFill` indeksował tablicę odwiedzonych
komórek od zera, więc na mapie nieskończonej z warstwą poza początkiem układu
zapętlał się; a menu kontekstowe zamykało się na `pointerdown` z okna, zanim
React zobaczył `click` — czyli **żadna pozycja tego menu nigdy się nie
wykonywała**.

### M7 wycofane — 10 września 2026

Powłoka Capacitora nie dawała nic, czego nie daje skrót PWA. To był błąd
projektowy w samym M7: żeby ominąć labirynt uprawnień do pamięci na Androidzie,
`CapacitorProjectFS` przez SAF zastąpiłem powłoką, która i tak łączy się
z serwerem w Termuxie po localhoście. Wtedy APK jest tylko drugim opakowaniem
tego samego `HttpProjectFS` — z własnym pipeline'em w CI, keystorem, konfiguracją
CORS i drugą ścieżką połączenia do utrzymania. Ktoś, kto zainstalowałby taki APK
bez Termuxa, dostałby ekran „uruchom serwer" i nic więcej.

Zostaje PWA: `Dodaj do ekranu głównego` daje tę samą ikonę i to samo okno bez
paska adresu, a serwer w Termuxie i tak jest wymagany w obu wariantach. Usunięte:
`android/`, `capacitor.config.ts`, `.github/workflows/android.yml`, zależności
Capacitora, flaga `--app` w CLI i związana z nią lista dozwolonych originów.
Gdyby kiedyś wrócił sensowny powód na natywną wersję, wracać trzeba do
`CapacitorProjectFS` przez SAF — czyli do prawdziwego dostępu do plików bez
serwera, a nie do powłoki wokół niego.

## 9. Ryzyka

| Ryzyko | Waga | Mitygacja |
|---|---|---|
| Wierność round-tripu gorsza niż zakładamy | Wysoka | Złote testy w M0 na wszystkich 110 mapach z `examples/`, przed UI |
| Funkcje formatu nieobecne w korpusie (inne kształty, atlasy, kompresja, grupy) wychodzą wadliwie na cudzych mapach | Średnia | Drugi zestaw testów na mapach z repo Tileda; świadomie oznaczone jako słabiej zweryfikowane (§5.4) |
| Panel tilesetu ładujący 250 osobnych PNG-ów | Średnia | To kolekcje obrazków, nie atlasy. Miniatury generowane i cache'owane po stronie serwera, lista wirtualizowana |
| Wydajność renderera | Niska | Mapa 50×50 to 2500 kafli na Adreno 650. Zapas jest ogromny. Interfejs `TileRenderer` i benchmark w M1 zostają, ale to formalność |
| Termux ubija serwer w tle | Średnia | Szkic każdej zmiany w IndexedDB (M10), szybki restart, `termux-wake-lock` w dokumentacji |
| Szeroki układ potraktowany jak „na pewno mysz" | Wysoka | Dwie niezależne osie (szerokość × wskaźnik) od M0; test na Tab S7 od M1, nie w M5 |
| Obrót tabletu przełącza cały układ | Niska | Trójstopniowe breakpointy — pion i poziom są po tej samej stronie granicy panele/arkusze |
| Brak kompresji zstd przy zapisie | Niska | Zapis jako zlib + ostrzeżenie; udokumentowane |
| Zakres pełzający w stronę „wszystkiego co ma Tiled" | Wysoka | Milestones są zamknięte; v1 kończy się na M3 |

## 10. Otwarte pytania

**Brak blokad. M0 ruszył.**

**Rozstrzygnięte 11 września 2026:**

1. ~~Kolizje w racing~~ → **zostają poza edytorem.** Racing ma kolizje, ale nie
   są to kolizje kafla w rozumieniu Tileda: `src/assets/road_walls.json` trzyma
   wypukłe części ścian per kafel, kluczowane nazwą pliku, a `trackN.collision.json`
   to ten sam atlas wypalony na tor. Gra nie czyta kolizji z `.tsj` — stempluje
   atlas po komórkach, z flipami. Oba pliki **generuje** `tools/track-mesh/`,
   a `ASSETS.md` zakazuje ich ręcznej edycji, więc edytor kształtów byłby
   narzędziem, którego wynik ginie przy następnym uruchomieniu generatora.
   Pokrycie atlasu sprawdzone i celowe: ściany mają wszystkie 90 kafli asfaltu,
   42 kafle terenu nie mają żadnych.

   Zmierzone przy okazji, jako ostrzeżenie na przyszłość: `racing.tsj` odwzorowuje
   kolejność plików w `tiles/` pozycja w pozycję (132 kafle, `asphalt → grass →
   sand → dirt`, każdy sortowany; 39 obiektów od gid 133). Gra liczy te same id
   z posortowanego globa, więc dodanie pliku o nazwie sortującej się wcześniej
   przenumerowuje wszystko po nim i po cichu psuje każdy tor. Edytor tego nie
   pilnuje — świadomie, bo to konwencja jednego projektu, a nie własność formatu.

**Rozstrzygnięte 9 września 2026:**

1. ~~Korpus referencyjny~~ → **`examples/` na main**, 110 map. Zastąpił
   niedostępny `kapsel-hub` i okazał się ważniejszy niż wszystkie pozostałe
   odpowiedzi razem: przestawił priorytet formatów, odwrócił zakres obiektów
   i przesunął lint do v1 (§5).
1. ~~Priorytet formatów~~ → **oba, JSON pierwszy.**
1. ~~Lint~~ → **do M3, w zakresie v1.**

2. ~~Orientacja map~~ → **ortogonalna wystarczy.** Izometryczna i heksagonalna
   wypadają z v1.1 do „później" (§5.2).
3. ~~Rozmiar map~~ → **do 50×50, w przyszłości mogą urosnąć.** Mapy
   nieskończone i chunki wypadają z v1.1 do „później"; furtką jest interfejs
   `LayerData` od M0 (§5.2).
4. ~~Urządzenie docelowe~~ → **Galaxy Tab S7.** Największa konsekwencja
   w całym planie: tablet ~1280×800 CSS px z dotykiem i S Penem wymusił
   rozdzielenie układu i wskaźnika na dwie osie (§7) oraz obniżył ryzyko
   wydajnościowe (§9).
