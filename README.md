# Wikivault

An offline replicate of Wikipedia with automatic monthly backup updates, searching and reading, and a light local AI assisted search feature. Hopefully this will never be needed, but in the case that web-services go down for an extended amount of time, having a local cache of information that is easy to use is a cheap safeguard!

Offline English Wikipedia for a Windows 11 laptop: the full edition with images stored on your own drive, replaced by a verified newer edition about once a month, searchable with no internet, and able to answer questions through an AI model running on the computer itself.

It runs on any 64-bit Windows 10/11 machine: the app measures the computer it is on and chooses between NPU, GPU and CPU, and between model sizes, by timing them there.

- **[User guide](docs/USER-GUIDE.md)**: first run, the optional partition, search, asking questions, tuning, memory and disk use, updating, uninstalling, troubleshooting.
- **[Changelog](CHANGELOG.md)**: every revision.
- **[Third-party notices](THIRD-PARTY-NOTICES.txt)** and **[licence](LICENSE)**.

## Before you use it

- **Answers can be wrong.** They are written by a small AI model on your computer from a copy of Wikipedia. Either can be mistaken. Check the cited articles.
- **Not professional advice.** Nothing the app shows is medical, legal, financial, engineering or safety advice.
- **It changes your computer when asked.** It downloads more than 100 GB and can create, resize and remove a disk partition. Back up first.
- **No warranty.** MIT licence, shared as it is. The installer and the app's first start ask you to accept these points.
- **Not affiliated** with, endorsed by or sponsored by Wikipedia, the Wikimedia Foundation, Kiwix, Microsoft or IBM.

## What it does

| Need | How |
|---|---|
| A local copy of Wikipedia | Downloads the Kiwix edition `wikipedia_en_all_maxi_YYYY-MM.zim` (all articles, with images, 110+ GB) from download.kiwix.org. Resumes after any interruption. |
| Regular backups | Checks daily for a newer edition (Kiwix publishes roughly monthly). Downloads it, verifies it, switches to it, and only then deletes the old one. |
| Offline search | Title suggestions as you type and full-text search over every article, served by the Kiwix reader engine on 127.0.0.1. |
| Local AI | Finds the passages that match your question, hands only those to a local model, and shows the answer with numbered links to the source articles. |
| A desktop window | Electron app with its own reader. No browser involved. Lives in the tray so updates happen on their own. |

## Install

**Installer:** download the latest `Wikivault-Setup-x.y.z.exe` from this repository's Releases (currently `Wikivault-Setup-0.10.1.exe`) and run it. It shows the licence and the points above and asks you to agree. It is not code-signed, so Windows SmartScreen will show "Windows protected your PC": choose *More info*, then *Run anyway*. Windows 11's Smart App Control, where it is switched on, blocks unsigned installers outright and has no per-app exception; the app can then only be installed with Smart App Control off.

Near the end the installer asks whether to install Microsoft Foundry Local, the program that runs the answer model. Say yes and it is installed with `winget`; Wikivault then downloads the model (a few GB) the first time it starts, with no further steps. Say no and the question is not asked again on later upgrades; answers can still be set up inside the app. The question is skipped when Foundry Local is already installed. For scripted installs, `/S` skips it and `/S --with-foundry` includes it.

**From source** (Node.js 20 or newer):

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
- Foundry Local / winget: only when you agreed to set up answers (installer question, first-run tick, or the Set up answers button). Those are separate Microsoft programs with their own network behaviour.

Nothing else. The browser engine inside the app has its own background traffic (component updates and similar) switched off. Article pages are loaded only from `127.0.0.1`; requests to any other address from the reader are cancelled, so articles cannot pull anything from the internet. Links that leave the offline copy ask before opening your browser. Questions and answers never leave the laptop.

## Testing status

Tested in a Linux build environment:

- `npm test`: 129 automated tests (22 of them need PowerShell 7 `pwsh` and are skipped without it). Parallel download across several mirrors of differing speed, a mirror that drops connections, one that lacks the file and one that serves bad data; download resume across dropped connections, servers that ignore Range, mirror redirects, cancel; checksum match, mismatch and missing checksum; the full update cycle including "old edition is removed only after the new one verifies"; staged updates through a second folder, including an interrupted move, a corrupted copy and a full drive; pause, app restart and resume; search, suggestions and article extraction against the real Kiwix reader engine (kiwix-serve 3.5.0) on a small Wikipedia-shaped test file; retrieval quality on sample questions; streaming answers; follow-up questions and conversation memory; the partition script, run for real under PowerShell against mocked Storage commands and a pretend disk (normal run, shrink limit exceeded, failed create with roll-back, failed format, declined approval, and merging back, including six kinds of partition it must refuse to remove); moving the library; a model that Foundry Local unloaded while idle (the service still lists it, inference refuses it) being loaded again through the service or, failing that, the command line; Foundry Local 0.14's local API as recorded from a real install (different routes from earlier versions, and a model list that is the whole catalog rather than what is loaded); search ordering on the real "differential" case; the tuning plan on catalogues shaped like an NPU laptop, an NVIDIA desktop and a CPU-only machine; releasing memory without touching another program's model; reading Foundry Local's catalogue file, timing builds of different speeds and picking the fastest, and pinning an exact build; the Foundry Local flow against a stand-in CLI in both its current (`foundry server …`) and older (`foundry service …`) spellings.
- The desktop app itself, driven with real mouse and keyboard input from first-run download through an edition update, including the checks that article pages cannot reach the internet.

- The installer, run under Wine (a Windows compatibility layer): a clean install, an in-place upgrade from 0.4.0 that kept settings, library and start-with-Windows entries, an install with `--with-foundry` on a machine without winget (the install completes and the app is told to finish the job), an uninstall that kept the data, and an uninstall with data removal that deleted the app's files and left an unrelated file in the library folder alone.

Not tested, because it needs the real machine:

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
src/main/main.js Electron main process: window, tray, IPC, network lockdown
src/preload.js   the only bridge between UI and main process
src/renderer/    the UI (plain HTML, CSS, JS)
test/            node:test suites, fixtures and test doubles
```

Environment variables for development: `WIKIVAULT_USER_DATA` (alternate settings folder), `WIKIVAULT_BASE_URL` (alternate download server), `WIKIVAULT_KIWIX_SERVE` (path to a kiwix-serve binary), `WIKIVAULT_FOUNDRY_CLI` (alternate `foundry` command), `WIKIVAULT_PARTITION_SIM` (JSON file describing a pretend drive, so the partition screen can be tried without touching a disk), `WIKIVAULT_PWSH` (path to `pwsh` for the partition tests).

On Linux or macOS the app runs for development if `kiwix-serve` is on the PATH.

## Licences and credits

Wikivault's own code: [MIT](LICENSE). Everything bundled with it is listed, with its licence, in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt): Electron and Chromium, ten small JavaScript libraries (MIT, BSD, ISC), and the IBM Plex Sans and IBM Plex Serif fonts (SIL Open Font License, unmodified files).

Not bundled, and downloaded by the app from their own publishers under their own terms: the Kiwix reader engine (GPL-3.0), the Wikipedia edition (text mostly CC BY-SA 4.0, media under their own licences), Microsoft Foundry Local, and the AI models.

Much of this code was written with an AI assistant, at the direction of and reviewed by the project's maintainer.
