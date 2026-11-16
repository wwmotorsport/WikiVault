# Wikivault user guide

How to set the app up and use it. For what it is and how to install it, see the [README](../README.md); for what changed in each version, the [changelog](../CHANGELOG.md).

## First run

1. Pick where to store the library. The default is `%LOCALAPPDATA%\Wikivault\library`. Or give it its own partition (next section).
2. Leave **Set up answers too** ticked if you want questions answered by the local model. It installs Foundry Local if the installer did not, and downloads the model alongside Wikipedia.
3. Press **Download Wikipedia**. The app first fetches the Kiwix reader engine (`kiwix-tools`, a few tens of MB), then the edition.
4. Leave it running. You can close the window; the download continues from the tray. If the laptop sleeps, loses Wi-Fi or restarts, the download picks up where it stopped.
5. When the download finishes the app hashes the whole file (a few minutes), opens it, and shows the Wikipedia main page.

If you already have a `.zim` file, choose **Use a .zim file I already have**. The file is used where it is and is never deleted by the app.

Disk space: an update needs room for the new edition next to the old one until the new one is verified, so keep about 120 GB free in addition to the installed edition.

## Giving the library its own partition (optional)

On the first-run screen, **Give Wikipedia its own partition** sets aside part of the system drive so everyday use of Windows cannot use up the room the library and its updates need.

The panel shows the drive as a bar with its total size, space in use, space free now, the proposed partition, and what stays free on `C:` afterwards. You can change the size with the slider or by typing.

There are two layouts, chosen with the checkbox at the top of the panel:

| | Updates download to C: first (default) | Self-contained |
|---|---|---|
| Partition holds | one edition | two editions during an update |
| Recommended size today | about 160 GB (edition plus 30% for growth) | about 270 GB (two editions plus 15%) |
| Smallest allowed | edition plus 5%, plus 2 GB | two editions plus 4 GB |
| What an update needs | about one edition's worth of free space on `C:` while it downloads and is checked | nothing outside the partition |
| If `C:` is too full at update time | the update waits; the current edition is unaffected | not applicable |

The largest size on offer always leaves 50 GB free on `C:` (plus room for one update in the default layout), and is never more than Windows says it can shrink by.

- **Nothing changes until you confirm.** The confirmation lists exactly what will happen, and Windows then asks for administrator approval.

What it does, using Windows' own Storage commands (`Resize-Partition`, `New-Partition`, `Format-Volume`): shrinks `C:`, creates a new NTFS volume named *Wikivault* in the freed space with the first free letter from `W:` downward, and formats that new volume. The library then lives in `W:\Wikivault`.

Safety rules built into the script (`src/core/partition.ps1`):

- Creating a partition never deletes or formats an existing one. The only thing formatted is the volume it has just created.
- If Windows cannot shrink `C:` as far as asked (some system files cannot be moved), it stops before changing anything and tells you the most it can do.
- If the new partition cannot be created after the shrink, `C:` is extended back to its original size.

If the laptop is on battery power, the app says so and asks for an extra confirmation before it will go ahead. The warning clears by itself when the charger is plugged in.

Things to know:

- Back up anything you cannot afford to lose first. Shrinking a live system drive is a standard Windows operation, but a power cut or disk fault partway through can damage a drive.
- If `C:` is protected by BitLocker (device encryption), the new partition is not encrypted.
- Only the system drive is offered. It is available before the first download, not afterwards.
- It can be undone from inside the app; see the next section.

### Going back to a folder

**Library > Stop using the partition** reverses the whole thing:

1. The library is copied to a folder on `C:` (you can choose which) and the copy is checked against its checksum. Wikipedia stays available.
2. The app switches to the verified copy and removes the one on the partition.
3. The Wikivault drive is removed and its space is added back to `C:`. Windows asks for administrator approval.

Removing a partition is the one destructive disk operation in the app, so the script refuses, and changes nothing, unless all of these hold: the drive is named *Wikivault*; it is on the same disk as `C:` and directly after it; it is not a Windows system or boot partition; and it contains nothing except an empty Wikivault folder (Windows' own `System Volume Information` and recycle bin are ignored). If anything else is on the drive, the library is still moved off safely, the drive is left alone, and the app tells you what it found. Remove those files and press **Remove drive** to finish.

If `C:` cannot be extended afterwards, the app says so and the space is left unallocated for Disk Management's *Extend Volume*.

A partition made by version 0.4 is recognised automatically.

### Moving the library

**Library > Move library** copies the edition to any folder you choose, checks the copy against its checksum, switches to it, and only then removes the old copy. If the copy does not verify, nothing changes.

## Download speed

A plain download from download.kiwix.org is one connection to whichever mirror its load balancer picks, which can be far slower than your line. Wikivault instead:

1. reads the list of mirrors Kiwix publishes for the file (`<file>.meta4`);
2. downloads a short sample from each, at the same time, and ranks them by speed;
3. splits the file into 32 MB chunks and fetches them over several connections at once (8 by default, at most 4 to any one mirror), each connection choosing the mirror that is currently fastest;
4. sets aside a mirror that keeps failing, does not have the file, or reports a different file size.

Progress is recorded every few seconds, after the data is flushed to disk, so an interrupted download carries on from where it was. A download started by an older version continues too. The whole file is still checked against the published SHA-256 at the end. If that check ever fails, the next attempt for that edition uses the plain single-connection method, in case one mirror served bad data.

The number of connections is under **Library > Updates**. The mirrors are run by volunteers, so 8 is a considerate default.

## Updating Wikivault itself

Run the newer `Wikivault-Setup-x.y.z.exe`. It closes a running copy, replaces the program files and keeps everything else: settings, the downloaded library, the reader engine and any partition. An interrupted Wikipedia download resumes afterwards. There is no automatic app updater, because that needs a place on the internet to publish releases; say if you want one set up.

## Uninstalling

Use *Settings > Apps > Installed apps > Wikivault > Uninstall*, or `Uninstall Wikivault.exe` in the install folder. Wikivault installs no Windows services; what it runs is the tray app (optionally started with Windows) and the reader engine it starts itself. The uninstaller:

- asks a running copy to close, which also stops the reader engine;
- removes the program files, shortcuts and the start-with-Windows entry;
- asks whether to also remove the library and settings. If you say yes it deletes the app's own files only: editions, partial downloads and the state file in the library folder, the staging folder's files, and `%APPDATA%\Wikivault` (settings, log, reader engine, caches). Anything else you put in the library folder is left alone;
- if a Wikivault partition exists, tells you before it starts and lets you cancel to remove the partition from inside the app first. The uninstaller never touches partitions.

- if Wikivault was what installed Foundry Local, asks whether to remove that too (default: keep, since other programs may use it). If Foundry Local was already on the PC it is left alone without asking; remove it yourself with `winget uninstall Microsoft.FoundryLocal`.

Models that Foundry Local downloaded are in Foundry Local's own cache and are not deleted by Wikivault's uninstaller.

For scripted use: `"Uninstall Wikivault.exe" /S` keeps the data, and `/S --delete-app-data` removes it. Add `--remove-foundry` to also remove Foundry Local when Wikivault installed it.

## How an update is made safe

The order never changes:

1. Download to `downloads\<name>.zim.part` (or to the staging folder on `C:`, see below).
2. Compute the SHA-256 of the file and compare it with the checksum published by download.kiwix.org. A mismatch discards the download and leaves the current edition untouched. An edition with no published checksum is refused.
3. Trial-open the new file with the reader engine while the old edition is still being served.
4. Switch the app to the new edition.
5. Delete the old edition.

`library\state.json` records the active edition, its checksum and when it was verified.

### Staged updates (the default with a dedicated partition)

When the partition holds only one edition, an update cannot sit next to the current one. Instead:

1. The new edition is downloaded to `%LOCALAPPDATA%\Wikivault\staging` on `C:` and checked against its published SHA-256 there. The library is not touched.
2. It is trial-opened, and the app switches to that verified copy on `C:`.
3. Only now is the old edition deleted from the library partition.
4. The new edition is copied into the partition, the copy is checked against the same SHA-256, and the app switches to it.
5. The staging copy on `C:` is deleted.

A verified edition is being served at every step. If the app or the laptop stops during step 4, the next start carries on from the verified copy on `C:` and resumes the copy. A copy that does not match the checksum is discarded and made again.

The very first download has nothing to protect, so it goes straight into the partition.

Why not smaller chunks? The published checksum covers the whole file, and the old edition can only be removed once the whole new one is known to be good, so the full new edition has to exist somewhere before the swap. Downloading in pieces would not reduce the space needed on `C:`; writing pieces over the old edition would, but an interrupted update would then leave no working Wikipedia at all.

## Setting up answers (the local model)

Answers use [Foundry Local](https://learn.microsoft.com/azure/foundry-local/), Microsoft's runtime that picks the NPU, GPU or CPU build of a model for the machine.

Setup is one step and is offered in three places, so use whichever you meet first: the installer's question, the **Set up answers too** tick on the first-run screen, or the **Set up answers** button that appears in the Ask panel (and under **Library > Answers**) whenever answers are not ready. Each does the same thing:

1. Installs Foundry Local with `winget install Microsoft.FoundryLocal` if the `foundry` command is missing. Windows may ask for approval.
2. Starts it, then downloads and loads the model. The default is `phi-4-mini`, which comes in builds for NPUs, GPUs and CPUs. This is a one-time download of a few GB and needs internet.
3. Progress is shown at the top of the Ask panel and under **Library > Answers**. Until it finishes, Ask shows the best-matching passages.
4. The status line then reads "Ready on the NPU, using …" with the exact model build. If it says GPU or CPU, Foundry Local did not find an NPU build it could run; check that Windows is 24H2 or newer and the AMD chipset/NPU driver is current.

After that, questions work with no internet. The app remembers the exact model build so it can load it offline.

Foundry Local takes a model out of memory when it has been idle. The first question after a long pause therefore takes longer: the Ask panel shows "Loading the model into memory" while the app loads it again, then answers as usual.

### Tune for this computer

**Library > Answers > Tune for this computer** measures the machine and sets answers up for it. Nothing in it is specific to one chip: every decision comes from the builds Foundry Local offers for the machine and from timings taken on it.

1. **Hardware.** One small model that has a build for each kind of hardware here (NPU, GPU, CPU) is timed on each. A family already timed everywhere is reused; otherwise the smallest download is chosen.
2. **Model.** On the fastest hardware, models are tried from the size the earlier timings predict will suit it: larger while writing stays at 10 tokens a second or more, smaller while it does not, three models at most. The largest that stays at or above that pace is chosen; if none does, the fastest. Models that think aloud before answering, code and vision models, and anything larger than half the machine's memory are left out.
3. **Settings.** The chosen model is timed with a small and a large amount of article text. The reading budget is the largest whose first word still comes within about 8 seconds without writing dropping below a usable pace; the answer length is the longest that takes about 45 seconds or less to write.

**What matters more** is a five-step slider from *Faster answers* to *More thorough answers*. It sets the three targets tuning aims for, and the line under it states them:

| Position | Writes at least | First word within | Full answer within |
|---|---|---|---|
| Fastest | 25 tokens/s | 3 s | 20 s |
| Fast | 15 | 5 s | 30 s |
| Balanced (default) | 10 | 8 s | 45 s |
| Thorough | 6 | 15 s | 75 s |
| Most thorough | 3 | 30 s | 120 s |

Moving it changes nothing until **Tune** is run again. Timings already taken are reused, so a second run usually only has to download the newly chosen model.

While a run is under way its progress sits directly under the button: which step it is on, an overall bar, a bar for the current action (a percentage for downloads, a moving band otherwise), and the action itself.

A model that fails to run is stepped over, and is not downloaded again on later runs for 30 days. Tuning does not try a larger model when the timings so far say it would plainly miss the target.

The plan (including what will be downloaded) is shown before anything starts, the run can be stopped, and the result lists what was measured and why each choice was made. Everything it sets can be changed by hand afterwards. It measures speed, not answer quality: "best model" here means the largest one that stays comfortable to read. With **Another model server on this laptop** only step 3 runs.

### Disk space and the record of results

- **Timings are kept.** Every timing (tokens a second, time to first word, load time, how much article text was used, and the date) is saved by exact build in `settings.json`, together with the last tuning's summary. They survive closing the app and upgrades, and are shown in the build table and under Tune for this computer. Tuning reuses them, so a build already timed is not downloaded again just to be timed.
- **After tuning, only the chosen model stays on disk.** Every other model download this app has made, in that run or earlier, is deleted from Foundry Local's cache, including one that failed to run. The timings stay. Models the app has never used (downloaded by you or another program) are not touched.
- "Find the fastest build" deletes only what that test downloaded and did not choose. **Remove download** on a row in the build table deletes one by hand.
- The build in use is never deleted.

### Memory

A loaded model holds several gigabytes, and Foundry Local keeps it loaded until told otherwise, even after the program that asked for it has gone. Wikivault therefore:

- takes the model out of memory after 3 minutes without a question (**Free the model's memory after**, 1 to 30 minutes or never). The next question loads it again, which adds a wait.
- after a speed test or tuning, leaves only the model in use loaded.
- when the window is closed to the tray, and when the app quits, unloads every model it has loaded (including ones left by an earlier run) and stops Foundry Local's background service. If some other program has a model loaded in Foundry Local, the service is left running.

### Choosing the model and the hardware it runs on

Each model in Foundry Local comes in several builds: one for the NPU, one for the GPU, one for the CPU, depending on the machine. Foundry Local's own default is not always the quickest. On the machine it was developed on it picks the NPU build of phi-4-mini, which writes about 2 tokens a second with 3,000 characters of article text.

**Library > Answers** lists every chat model Foundry Local offers for this computer (read from Foundry Local's own catalogue, so it needs no internet), and for the chosen model a table of its builds: what each runs on, its download size, and its speed here once timed.

- **Find the fastest of these builds** downloads any NPU or GPU build that is missing (the size is stated first), gives each the same test question with the amount of article text Ask really sends, records the time to the first word and the tokens a second, takes each build out of memory again, and switches Wikivault to the fastest. The CPU build is only included when it is the only one or is already downloaded. Results are kept and shown next time.
- **Use** / **Download and use** switches to one build directly.
- The Model list is for browsing; nothing changes until you press a button. Larger models answer better and write more slowly; about 10 tokens a second or more reads comfortably.

Using the NPU and GPU together: Foundry Local's builds use one or the other. AMD's own Lemonade Server has a hybrid mode for some of AMD's laptop chips in which the NPU reads the prompt and the GPU writes the answer. Wikivault can use it through **Another model server on this laptop**, but it has not been tried on this laptop.

Other options in the same section:

- **Another model server on this laptop**: any OpenAI-compatible endpoint (Ollama, LM Studio, AMD Lemonade Server, llama.cpp).
- **Reading budget**: how much article text the model is given per question. Smaller is faster; NPU builds of small models also have short context windows, so "Medium" is the default.
- **Answers off**: Ask then shows the best-matching passages with no model involved.

### Follow-up questions

The Ask panel is one conversation. A follow-up such as "Where did he study?" works because:

1. The model first rewrites it into a question that stands alone ("Where did Neil Armstrong study?"). The panel shows this as "Understood as: …" so you can see how it was read.
2. The search runs on the rewritten question, and the articles the previous answer cited stay in play.
3. The last three questions and answers are shown to the model when it writes the new answer.

The conversation is held in memory only. It is never written to disk, and it is forgotten when you press **New conversation**, when the edition changes, or when the app closes. Start a new conversation when you change subject: it keeps answers fast and stops an old topic colouring a new one.

With answers turned off, follow-ups still stay on the article the last result came from, but nothing is rewritten.

What to expect: a 3 to 4 billion parameter model summarises passages well and cites them, but it is not a cloud-class model. It can misread a passage. Every answer lists the passages it used so you can check.

## How search orders results

The reader engine's full-text search ranks articles by how often the words occur in the body and ignores titles, so "differential" used to lead with "Differential equation" and never showed the article called "Differential". Search now merges the title index with the engine's first 50 full-text results and orders them together: an exact title first, then titles that are the query plus a qualifier in brackets, then titles that start with or contain the words, with the engine's own order deciding the rest. "List of…" pages are moved down unless a list was asked for. Results that came only from the title index show the article's opening lines.

When no article contains every word, the search is retried without filler words and then with one word left out at a time, shortest first, and the page says which word was dropped. There is no spelling correction: the engine does not expose one.

## Keyboard

`Ctrl+K` search, `Ctrl+F` find in article, `Alt+Left` / `Alt+Right` back and forward, `Ctrl +` / `Ctrl -` / `Ctrl 0` zoom.

## Where things are stored

| What | Where |
|---|---|
| Editions | `<library>\zim\` |
| Partial downloads | `<library>\downloads\` |
| Edition state | `<library>\state.json` |
| Settings, log, reader engine | `%APPDATA%\Wikivault\` (`settings.json`, `wikivault.log`, `engine\`) |

## If something goes wrong

- **Nothing downloads / "Could not reach the Kiwix download server"**: check the connection and press Try again. `wikivault.log` has details.
- **The reader engine could not be downloaded**: download `kiwix-tools_win-x86_64-*.zip` (or `win-i686`) from https://download.kiwix.org/release/kiwix-tools/ and unzip it into `%APPDATA%\Wikivault\engine\`. Or set `enginePath` in `settings.json` to the full path of `kiwix-serve.exe`.
- **"Foundry Local would not keep the model loaded"**: the app already tried loading the model twice. Run `foundry service restart` in a terminal and ask again. If it keeps happening, `foundry model load phi-4-mini` in a terminal shows Foundry Local's own error.
- **"Foundry Local was not found"** right after installing it by hand: press **Set up answers** again (the app re-reads the PATH), or restart Wikivault. `foundry --version` in a terminal confirms the install.
- **Answers are slow or cut off**: lower the reading budget, or pick a smaller model.
- **Full-text search finds nothing**: it needs every word to match. Use fewer words. (Ask loosens the query automatically.)
