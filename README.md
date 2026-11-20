# Wikivault

Offline English Wikipedia for a Windows 10/11: the full edition with images stored on your own drive, replaced by a verified newer edition about once a month, searchable with no internet, and able to answer questions through an AI model running on the computer itself.

FULL DISCLOSURE: I am not a programmer or a software engineer. This entire project was vibe-coded with Claude and has only been tested on the machine it was developed from. USE AT YOUR OWN RISK. 

## Download and install

<!-- download:start -->
### [Download the installer: Wikivault-Setup-0.26.1.exe](https://github.com/wwmotorsport/WikiVault/releases/download/v0.26.1/Wikivault-Setup-0.26.1.exe)

Version 0.26.1, 139 MB, for Windows 10 and 11 (64-bit). Clicking the link starts the download.
<!-- download:end -->

**Looking for the installer in the list of files above? It is not there.** GitHub does not allow a file this large in that list, so it is kept on this repository's **Releases** page. The link above goes straight to it.

From this page to a working app:

1. **Sign in to GitHub.** While this repository is private, the page and the download only work for accounts that have been invited to it.
2. **Download the installer** with the link above. To find it by hand instead: open **Releases** (in the right-hand column on a computer, further down the page on a phone), choose the newest release, open **Assets**, and click the file whose name ends in **`.exe`**. Do not take "Source code (zip)" or "Source code (tar.gz)": those are the program's source, not something you can run.
3. **Keep the file** if the browser says it "isn't commonly downloaded" (in Edge: the three dots beside the download, then *Keep*).
4. **Open your Downloads folder and double-click** `Wikivault-Setup-0.15.0.exe`.
5. **"Windows protected your PC"** appears because the installer is not code-signed. Click *More info*, then *Run anyway*. If Windows instead says **Smart App Control** blocked it, there is no "run anyway": see the [user guide](docs/USER-GUIDE.md#installing-step-by-step).
6. **Follow the installer.** It shows the licence and the points below and asks you to agree, then asks whether to install Microsoft Foundry Local, the program that writes the answers. Say yes unless you only want search and reading.
7. **Start Wikivault.** Choose how much of Wikipedia to keep and where to keep it, then press **Download Wikipedia**. The full edition is more than 100 GB and takes hours on most connections; it can be paused and picks up where it stopped.
8. **To update later**, download the newer installer the same way and run it. Your library and settings are kept.

The [user guide](docs/USER-GUIDE.md#installing-step-by-step) has the same steps in more detail.

## Before you use it

- **Answers can be wrong.** They are written by a small AI model on your computer from a copy of Wikipedia. Either can be mistaken. Check the cited articles.
- **Not professional advice.** Nothing the app shows is medical, legal, financial, engineering or safety advice.
- **It changes your computer when asked.** It downloads more than 100 GB and can create, resize and remove a disk partition. Back up first.
- **No warranty.** MIT licence, shared as it is. The installer and the app's first start ask you to accept these points.
- **Not affiliated** with, endorsed by or sponsored by Wikipedia, the Wikimedia Foundation, Kiwix, Microsoft or IBM.

## What it does

| Need | How |
|---|---|
| A local copy of Wikipedia | Downloads a Kiwix edition of English Wikipedia from download.kiwix.org: everything with images (110+ GB), every article without images (about a quarter of that), or introductions only. Setup shows the real sizes and whether each fits. Resumes after any interruption. |
| More than Wikipedia | English Wikibooks (textbooks and manuals) and Wikiversity (courses and lessons) can be added from the Library page and are searched, read, asked about and updated the same way. |
| Regular backups | Checks daily for a newer edition (Kiwix publishes roughly monthly). Downloads it, verifies it, switches to it, and only then deletes the old one. |
| Offline search | Title suggestions as you type and full-text search over every article, served by the Kiwix reader engine on 127.0.0.1. |
| Local AI | Finds the passages that match your question, hands only those to a local model, and shows the answer with numbered links to the source articles. |
| A year of school (in development) | Not in this version. A Grade 5 year of lessons, week by week, is being built on the `school` branch and is switched off in the released app until it is ready. See [docs/SCHOOL.md](docs/SCHOOL.md). |
| A map that works offline | A road map of the regions you choose, cut from OpenStreetMap after the app has measured how big each level of detail would be, with hospitals, water, fuel, food, hardware and other places searchable by name, kind and distance, and turn-by-turn directions by car, bicycle or on foot that can be re-made around roads and areas you mark as blocked. See the [user guide](docs/USER-GUIDE.md#map). |
| Something to do | Wiki golf, in an 8-bit style: get from one article to another using only the links inside the articles, in as few clicks as possible. One to six players take turns on the same computer; players, characters, records and handicaps are kept in a clubhouse. |
| Finding your way | A guided tour with numbered pins opens at each start until it is switched off, and once after each update. |
| A desktop window | Electron app with its own reader. No browser involved. Lives in the tray so updates happen on their own. |

It runs on any 64-bit Windows 10/11 machine: the app measures the computer it is on and chooses between NPU, GPU and CPU, and between model sizes, by timing them there.

- **[User guide](docs/USER-GUIDE.md)**: first run, the optional partition, search, asking questions, tuning, memory and disk use, updating, uninstalling, troubleshooting.
- **[Changelog](CHANGELOG.md)**: every revision.
- **[Third-party notices](THIRD-PARTY-NOTICES.txt)** and **[licence](LICENSE)**.

## Running from source

Most people want the installer: see [Download and install](#download-and-install) at the top. To run the code directly instead (Node.js 20 or newer):


```
npm install
npm start
```

Build the installer yourself on Windows with `npm run dist` (output in `dist/`).

## Building and releasing

```
npm install
npm test          # unit tests (the partition tests need PowerShell 7, the engine tests need kiwix-serve)
npm run dist      # writes THIRD-PARTY-NOTICES.txt, then builds dist/Wikivault-Setup-x.y.z.exe (on Windows)
```

`.github/workflows/build.yml` builds the installer on a GitHub Windows runner when a tag `vX.Y.Z` is pushed, or when run by hand, and attaches it to a release. That workflow has not yet been run; the installers so far were built under Wine on Linux.

Each revision is one commit, tagged `vX.Y.Z`, with an entry in the changelog.

## What touches the network

- `download.kiwix.org` and the Kiwix mirrors it lists: edition listing, the mirror list, the edition file, its checksum, and the reader engine. Daily check plus downloads.
- `library.kiwix.org`: only as a fallback if the listing above cannot be read.
- `build-metadata.protomaps.dev` and `build.protomaps.com`: only when you press Measure or Download in the Map section. The app reads the index of the world map, then the parts of it you chose.
- `brouter.de`: only when you press Measure or Download for the routing data in the Map section.
- `download.geofabrik.de`: only when you fetch the places in the Map section or on the Setup page. Regional OpenStreetMap extracts are downloaded, one to a state or province, read on your computer and deleted. Nothing about you or your places is sent.
- `cdn.jsdelivr.net` and `data.cms.gov`: only when you fetch the addresses and added places. From the first comes the Name Suggestion Index, a public list of brands used to sort places into kinds; from the second, Medicare's public list of United States hospitals, fetched when a United States region is chosen. Nothing about you or your places is sent to either: each is one plain download.
- `overpass-api.de`, or `overpass.private.coffee` if the first is busy: only when you choose *Another way* under Fetch the places in the Map section. The questions sent name kinds of places and areas of the map, nothing about you.
- `www.coreknowledge.org`: only in a build with School switched on (it is off in this version), and then only when you press Download in the School section. It fetches that publisher's PDF files and nothing else.
- Foundry Local / winget: only when you agreed to set up answers (installer question, first-run tick, or the Set up answers button). Those are separate Microsoft programs with their own network behaviour.

Nothing else. The browser engine inside the app has its own background traffic (component updates and similar) switched off. Article pages are loaded only from `127.0.0.1`; requests to any other address from the reader are cancelled, so articles cannot pull anything from the internet. Links that leave the offline copy ask before opening your browser. Questions and answers never leave the laptop.

## Testing status

Tested in a Linux build environment:

- `npm test`: 246 automated tests. One of them runs the real routing engine on test roads and is skipped where Java is not installed (22 of them need PowerShell 7 `pwsh` and are skipped without it). Parallel download across several mirrors of differing speed, a mirror that drops connections, one that lacks the file and one that serves bad data; download resume across dropped connections, servers that ignore Range, mirror redirects, cancel; checksum match, mismatch and missing checksum; the full update cycle including "old edition is removed only after the new one verifies"; staged updates through a second folder, including an interrupted move, a corrupted copy and a full drive; pause, app restart and resume; search, suggestions and article extraction against the real Kiwix reader engine (kiwix-serve 3.5.0) on a small Wikipedia-shaped test file; retrieval quality on sample questions; streaming answers; follow-up questions and conversation memory; the partition script, run for real under PowerShell against mocked Storage commands and a pretend disk (normal run, shrink limit exceeded, failed create with roll-back, failed format, declined approval, and merging back, including six kinds of partition it must refuse to remove); moving the library; a model that Foundry Local unloaded while idle (the service still lists it, inference refuses it) being loaded again through the service or, failing that, the command line; Foundry Local 0.14's local API as recorded from a real install (different routes from earlier versions, and a model list that is the whole catalog rather than what is loaded); search ordering on the real "differential" case; the tuning plan on catalogues shaped like an NPU laptop, an NVIDIA desktop and a CPU-only machine; releasing memory without touching another program's model; reading Foundry Local's catalogue file, timing builds of different speeds and picking the fastest, and pinning an exact build; the Foundry Local flow against a stand-in CLI in both its current (`foundry server …`) and older (`foundry service …`) spellings.
- The desktop app itself, driven with real mouse and keyboard input from first-run download through an edition update, including the checks that article pages cannot reach the internet.

- The installer, run under Wine (a Windows compatibility layer): a clean install, an in-place upgrade from 0.4.0 that kept settings, library and start-with-Windows entries, an install with `--with-foundry` on a machine without winget (the install completes and the app is told to finish the job), an uninstall that kept the data, and an uninstall with data removal that deleted the app's files and left an unrelated file in the library folder alone.

Not tested, because it needs the real machine:

- Parts of the Map section against the real servers. Measuring and downloading the map have now run on the real machine. Fetching places, and measuring and downloading the routing data from brouter.de, have only run against stand-ins, because the build environment cannot reach those servers. Directions were tested with the real engine on a small set of test roads, not on real roads. Drawing ran with software graphics.

- The School section's page numbers, by eye. The downloads have now run on the real machine (104 of 105 files arrived, 708 MB), and the lesson finder and guided lessons were checked against the text of those files. What has not been checked is each opened page as printed: the build environment can read the text of the pages but cannot look at them.

- Links between projects on real editions. The app recognises the usual web addresses of English Wikipedia, Wikibooks and Wikiversity pages; how the real files write such links, and how often the page names match, has only been seen through one report from real use.
- Wiki golf on a real edition. The rules, the scoring and the laying out of holes are tested on a made-up set of linked pages and on a six-article test library. On a real edition one round was played before 0.15.0 and the target was not recognised; the cause was not reproduced, so 0.15.0 adds a second way of recognising it and logs every click. How good the holes are on the real link structure (how obscure the targets, how fair the pars) has not been seen.
- Wikibooks and Wikiversity against Kiwix's real files. The download, checksum and switching code is the same as for Wikipedia and was tested against a stand-in server; the real file names and sizes have not been fetched by this code.

- The partition step against a real disk. Its logic and every failure path are tested, but the real `Resize-Partition`, `New-Partition` and `Format-Volume` commands have never been run by this code, and it was tested under PowerShell 7 rather than the Windows PowerShell 5.1 it will use.
- Running on Windows itself. The installer was cross-built; Windows-only paths (downloading and unpacking the Windows reader engine, tray, start-with-Windows) are exercised by unit tests where possible but have not run on Windows.
- The real 110+ GB download and Kiwix's real mirror list. The sandbox this was built in cannot reach Kiwix, so mirror discovery has only run against a stand-in server that mimics the published format. If the list cannot be read, the download still runs over several connections through the main address.
- Search speed on an edition that size.
- Installing Foundry Local through winget, from the installer or the app. The commands follow Microsoft's install page, but they have only run against stand-ins here.

Checked on a real Windows 11 laptop with an NPU and an integrated GPU (Foundry Local 0.14.0), by calling Foundry Local's local API directly:

- `phi-4-mini-instruct-vitis-npu:2` loads on the NPU and answers. The first word arrives within 0.4 to 5 seconds, but writing is slow and slows further as more article text is supplied: about 6 tokens a second with almost none, 2.9 with 1,500 characters, 2.2 with 3,000 and 1.5 with 6,000. A 150-word answer therefore takes a minute or more. **Reading budget: Small** in Library > Answers is the quickest setting; the GPU build of the same model (`Phi-4-mini-instruct-generic-gpu:5`, entered as the model name) has not been timed.
- Full-text search on the full edition answers in about 0.3 seconds (84,809 articles for "differential").
- Which routes that version serves. It differs from Microsoft's published REST reference: `/models/loaded` and `/models/load/<id>` instead of `/openai/loadedmodels` and `/openai/load/<id>`, no `/foundry/list`, and `/v1/models` lists the whole catalog. Wikivault tries the 0.14 routes first and the older ones second. Foundry Local is still labelled preview, so this may move again.

## Code map

```
src/core/        no Electron dependencies; everything here is unit-tested
  catalog.js     finds the newest edition, its checksum, and the engine download
  downloader.js  resumable downloads: one connection, or many in parallel chunks
  mirrors.js     reads Kiwix's mirror list and ranks mirrors by measured speed
  verify.js      SHA-256 and .zim header check
  partition.js   sizes and runs the optional dedicated partition step
  partition.ps1  the PowerShell that shrinks C: and creates the new volume, and merges it back
build/installer.nsh  installer and uninstaller additions (close running copy, clean-up, data removal)
  updater.js     download → verify → trial-open → switch → delete old; daily schedule
  engine.js      installs, starts and queries kiwix-serve
  extract.js     article HTML → plain-text passages
  rank.js        keywords and BM25 passage ranking
  rag.js         retrieval, conversation memory and prompt building
  llm.js         Foundry Local and OpenAI-compatible local servers
  golf.js        wiki golf: lays out holes and keeps the round and the scorecard
  golf-store.js  wiki golf: saved players, their records and handicaps
  tour.js        when the guided tour opens by itself
  links.js       recognises links from one Wikimedia project to another
  pmtiles.js     Maps: the PMTiles file format, tile numbers, and the tiles that cover a region
  map-extract.js Maps: measuring and cutting a region out of a PMTiles file on a web server
  places.js      Maps: questions for the places server, the records kept, and searching them
  maps-library.js  Maps: what is on disk, and fetching the map, the places and the routing data
  routing.js     Directions: what to ask the engine, and its answer as steps
  route-engine.js  Directions: BRouter as a helper process on a local port
  mvt.js         a small reader of vector tiles, for road names
  overture.js    Overture Maps: finds the release, fetches only the rows a region needs, builds addresses and places
  overture-worker.js  runs that on its own thread
  addresses.js   the address index: street names, typed addresses, and placing a number between its neighbours
  vcard.js       contacts files: vCard and CSV
  contacts-sync.js  contacts from Google (sign-in and People service) and iCloud (CardDAV); read only
  address-book.js  the address book: entries, where they are, and what came from which account
  relations.js   pins, relationship groups and ties, and the everyday words for a tie
  map-ask.js     requests typed into Ask that are for the map: recognised, and their places found
  features.js    which parts of the app a build leaves out while they are being finished (School, for now)
  osm-pbf.js     reads OpenStreetMap extracts (.osm.pbf): the things with wanted tags, each with a position
  places-extract.js  places out of one extract, as the records the places code uses (and its worker thread)
src/renderer/map-style.js  the look of the map: day and night colours, road weights, kinds that can be switched off
src/renderer/nmea.js, guide.js  GPS: reading a receiver's sentences, and following a route
src/renderer/gps.js, book.js, hub.js  the GPS box, the Saved tab, and the Setup and downloads page
assets/routing/  BRouter (brouter.jar, MIT) and its profiles; BUILD.txt says how the jar was made
scripts/fetch-java.js  fetches the Windows Java runtime for the installer and checks it against a pinned checksum
  school.js      School: the year plan, guided lessons, and finding answer-key and test pages from page text
  school-outline.js  School: the lessons of a teacher guide and the timed steps inside each, from page text
  school-library.js  School: downloads, the text index, search, progress and added books
  pdf-text.js    the text of each page of a PDF
src/vendor/pdfjs/    PDF.js, unmodified (Apache 2.0)
src/vendor/maplibre/, pmtiles/, basemaps/   the map libraries (BSD 3-Clause), copied in by `npm run vendor-maps`
assets/maps/     regions, levels of detail and kinds of place; map fonts and icons
assets/gear.json hardware the app can point people to (a GPS receiver), as a name and a web link
assets/school/   the registry of each grade: subjects, units, files and what must be bought
src/main/school-indexer.js  reads PDFs in a helper process so the window stays responsive
src/main/main.js Electron main process: window, tray, IPC, network lockdown
src/preload.js   the only bridge between UI and main process
src/renderer/    the UI (plain HTML, CSS, JS)
test/            node:test suites, fixtures and test doubles
```

Environment variables for development: `WIKIVAULT_USER_DATA` (alternate settings folder), `WIKIVAULT_BASE_URL` (alternate download server), `WIKIVAULT_KIWIX_SERVE` (path to a kiwix-serve binary), `WIKIVAULT_FOUNDRY_CLI` (alternate `foundry` command), `WIKIVAULT_PARTITION_SIM` (JSON file describing a pretend drive, so the partition screen can be tried without touching a disk), `WIKIVAULT_PWSH` (path to `pwsh` for the partition tests).

On Linux or macOS the app runs for development if `kiwix-serve` is on the PATH.

## Licences and credits

Wikivault's own code: [MIT](LICENSE). Everything bundled with it is listed, with its licence, in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt): Electron and Chromium, ten small JavaScript libraries (MIT, BSD, ISC), and the IBM Plex Sans, IBM Plex Serif and Press Start 2P fonts (SIL Open Font License, unmodified files). The characters and course in wiki golf are drawn by the app's own code.

The installer also carries BRouter (MIT) and a Java runtime, Eclipse Temurin (GPL 2 with the Classpath Exception), which Wikivault runs unchanged.

Not bundled, and downloaded by the app from their own publishers under their own terms: routing data from the BRouter project (© OpenStreetMap contributors, Open Database License), the map and the places on it (© OpenStreetMap contributors, Open Database License; the map file is cut from the Protomaps basemap, and the places are read out of the regional extracts Geofabrik publishes), the Core Knowledge Foundation's Grade 5 materials (CC BY-NC-SA 4.0; the mathematics is based on Illustrative Mathematics' IM K-5 Math, CC BY 4.0; not for sale), the Kiwix reader engine (GPL-3.0), the Wikipedia edition (text mostly CC BY-SA 4.0, media under their own licences), Microsoft Foundry Local, and the AI models.

Much of this code was written with an AI assistant, at the direction of and reviewed by the project's maintainer.
