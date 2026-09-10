# Tile Editor — plan projektu

Nowoczesna alternatywa dla Tiled: edytor map 2D działający w przeglądarce,
z pierwszorzędnym wsparciem dla Androida/Termuxa, pełną obsługą TMX
i opcjonalnym wydaniem jako APK.

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
- da się opcjonalnie wydać jako PWA i APK.

## 2. Ograniczenia, które kształtują architekturę

| Ograniczenie | Konsekwencja projektowa |
|---|---|
| Brak Electrona i realnego Android SDK w Termuxie | APK budowany wyłącznie w CI (GitHub Actions), nigdy na urządzeniu |
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
apps/
  android/     Capacitor 7, budowany wyłącznie w GitHub Actions
```

### 4.1. `ProjectFS` — kluczowa abstrakcja

Jeden interfejs (`list`, `read`, `write`, `watch`, `resolve`, `stat`)
z czterema implementacjami:

| Adapter | Target | Mechanizm |
|---|---|---|
| `HttpProjectFS` | **Termux (główny)** | REST + SSE do serwera Fastify |
| `CapacitorProjectFS` | APK | `@capacitor/filesystem` + folder wybrany przez SAF |
| `FsaProjectFS` | Desktop Chrome bez serwera | File System Access API |
| `MemoryProjectFS` | Testy, demo online | W pamięci, seed z ZIP-a |

To ta jedna abstrakcja sprawia, że web, Termux i APK to ten sam kod. Nic
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

**v1.1:** ~~`animation`~~ (zrobione w M4) · kolizje kafla · szablony `.tx` ·
custom types (`propertyTypes`) · zstd.

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
| **M5** | Dopracowanie mobile UX, PWA (installable, offline), wydajność na słabszych telefonach | Instalowalne z ekranu domowego, działa offline | — |
| **M6** | Autotiling (Wang sets + reguły w stylu LDtk), command palette, wyszukiwanie w projekcie, lint mapy | Funkcje, których Tiled nie ma albo ma gorsze | lint już w v1 |
| **M7** | Capacitor 7, `CapacitorProjectFS` przez SAF, pipeline APK w GitHub Actions | Podpisany APK do pobrania z Actions | — |

## 9. Ryzyka

| Ryzyko | Waga | Mitygacja |
|---|---|---|
| Wierność round-tripu gorsza niż zakładamy | Wysoka | Złote testy w M0 na wszystkich 110 mapach z `examples/`, przed UI |
| Funkcje formatu nieobecne w korpusie (inne kształty, atlasy, kompresja, grupy) wychodzą wadliwie na cudzych mapach | Średnia | Drugi zestaw testów na mapach z repo Tileda; świadomie oznaczone jako słabiej zweryfikowane (§5.4) |
| Panel tilesetu ładujący 250 osobnych PNG-ów | Średnia | To kolekcje obrazków, nie atlasy. Miniatury generowane i cache'owane po stronie serwera, lista wirtualizowana |
| Wydajność renderera | Niska | Mapa 50×50 to 2500 kafli na Adreno 650. Zapas jest ogromny. Interfejs `TileRenderer` i benchmark w M1 zostają, ale to formalność |
| Termux ubija serwer w tle | Średnia | Stan zawsze w plikach, szybki restart, `termux-wake-lock` w dokumentacji |
| Szeroki układ potraktowany jak „na pewno mysz" | Wysoka | Dwie niezależne osie (szerokość × wskaźnik) od M0; test na Tab S7 od M1, nie w M5 |
| Obrót tabletu przełącza cały układ | Niska | Trójstopniowe breakpointy — pion i poziom są po tej samej stronie granicy panele/arkusze |
| Brak kompresji zstd przy zapisie | Niska | Zapis jako zlib + ostrzeżenie; udokumentowane |
| Zakres pełzający w stronę „wszystkiego co ma Tiled" | Wysoka | Milestones są zamknięte; v1 kończy się na M3 |

## 10. Otwarte pytania

**Brak blokad. M0 ruszył.**

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
