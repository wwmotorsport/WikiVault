# Wikivault user guide

How to install the app, set it up and use it. For what it is, see the [README](../README.md); for what changed in each version, the [changelog](../CHANGELOG.md).

## Installing, step by step

Everything from finding the installer to reading your first article. Allow ten minutes for the steps, then however long the download of Wikipedia takes.

**Before you start** you need a Windows 10 or 11 computer (64-bit), an internet connection for the setup, and free disk space: well over 100 GB for the full Wikipedia with images, roughly a quarter of that without images, and a few GB for introductions only. The setup screen shows the real size of each and whether your drive has room.

### 1. Get the installer

<!-- download:start -->
The direct link is **[Wikivault-Setup-0.15.0.exe](https://github.com/wwmotorsport/WikiVault/releases/download/V0.15.0/Wikivault-Setup-0.15.0.exe)** (Version 0.15.0, 116 MB).
<!-- download:end -->

The installer is not in the list of files on the repository's front page, because GitHub does not allow files that large there. To find it by hand:

1. Sign in to GitHub. While the repository is private, only invited accounts can see it or download from it.
2. On the repository's front page, find **Releases**. On a computer it is in the right-hand column; on a phone it is further down the page, below the description.
3. Click the newest release (the one at the top).
4. Under **Assets**, click the file whose name ends in **`.exe`**, for example `Wikivault-Setup-0.15.0.exe`.

Leave "Source code (zip)" and "Source code (tar.gz)" alone. GitHub adds those to every release; they contain the program's source, not an installer. If the release also offers a `.zip` with the same name as the installer, it is the same installer inside a zip folder: open it and drag the `.exe` out first.

If the browser says the file "isn't commonly downloaded", keep it. In Edge: click the three dots beside the download and choose *Keep*, then *Keep anyway*. In Chrome: click the arrow beside the download and choose *Keep*.

### 2. Run the installer

1. Open your **Downloads** folder and double-click `Wikivault-Setup-0.15.0.exe` (the number will match the version you downloaded).
2. A blue box saying **"Windows protected your PC"** appears, because the installer is not code-signed. Click **More info**, then **Run anyway**.
3. The installer shows the licence and a short notice (answers can be wrong, it is not professional advice, it can change disk partitions when you ask it to). Read it and click **I Agree**.
4. Accept what the next screens suggest (who the program is for, where it is installed) and click **Install**.
5. Near the end it asks whether to install **Microsoft Foundry Local**, the program that writes the answers on your computer. **Yes** is right for most people. **No** leaves you with search and reading only; answers can be switched on later from the Library page.
6. Click **Finish**. Wikivault starts, and a shortcut is added to the Start menu.

**If Windows says "Smart App Control blocked an app that may be unsafe"** there is no "run anyway" button. Smart App Control only allows signed apps, and Wikivault is not signed. The only way to install is to switch Smart App Control off: *Windows Security > App & browser control > Smart App Control settings > Off*. Read what that screen says first. On many versions of Windows it cannot be switched back on without resetting the computer, and it is a real protection, so this is a decision to make deliberately, not a step to click through.

### 3. First start

1. Wikivault shows the same short notice once more. Click **I understand and agree**.
2. **Choose how much of Wikipedia to keep.** Each size shows its real download size and whether it fits. If you have the room, take everything with images.
3. **Choose where to keep it.** The folder that is suggested is fine. Giving Wikipedia its own partition is optional and explained later in this guide; it can also be done afterwards.
4. Click **Download Wikipedia**. Progress, speed and the time left are shown. You can pause, close the window or restart the computer; the download picks up where it stopped. The full edition takes a few hours on a fast connection and much longer on a slow one. Keep the computer plugged in.
5. When the download finishes, the app checks it against the published checksum and opens the front page of Wikipedia. A short tour points out what the buttons do.
6. If you said yes to Foundry Local, the answer model (a few GB) is downloaded the first time you press **Ask**. After that, **Library > Answers > Tune for this computer** picks the best model for your hardware.

From here on the app works with no internet.

### Updating to a newer version

Download the newer installer the same way and run it. It replaces the app and keeps your library, settings and wiki golf records. The tour opens once after each update with a short list of what is new.

### Removing it

*Windows Settings > Apps > Installed apps > Wikivault > Uninstall*. The uninstaller asks whether to remove the downloaded library and your settings as well; choose No if you plan to install again.

## First run

**How much of Wikipedia.** Kiwix publishes English Wikipedia in three sizes, and the setup screen lists them with the real size of the newest edition of each:

- **Everything, with images.** Every article in full with its pictures and diagrams. The most useful and by far the largest.
- **Every article, no images.** The full text, about a quarter of the size. Diagrams, maps and photographs are missing, which matters most for how-to, medical and identification topics.
- **Introductions only.** The opening section and fact box of each article, about a twentieth of the size.

Under each is a verdict for the place you chose: whether it fits, how much it leaves free, and whether there is also room for monthly updates (an update needs the edition's size again while the old copy is replaced, unless you use a dedicated partition). The largest size that fits with room to spare is selected for you. The choice can be changed at any time afterwards under Library (see *Changing how much of Wikipedia is kept*).


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
| Recommended size today | about 180 GB (edition plus 30% for growth, plus about 20 GB for Wikibooks and Wikiversity) | about 290 GB (two editions plus 15%, plus the same 20 GB) |
| Smallest allowed | edition plus 5%, plus 2 GB, plus any other libraries already downloaded | two editions plus 4 GB, plus any other libraries already downloaded |
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

**Library > Move library** copies the edition, and Wikibooks and Wikiversity if you have them, to any folder you choose, checks the copy against its checksum, switches to it, and only then removes the old copy. If the copy does not verify, nothing changes.

## Changing how much of Wikipedia is kept

**Library > How much of Wikipedia** lists the same three sizes as the first-run screen, with the real size of each and a mark on the one you have. Tick another and press the button that appears; nothing happens before that.

The other size is downloaded and checked while you keep using the copy you have, which is deleted only after the switch. That means both have to fit for a while:

- with the library in a folder, the drive needs free space for the new size;
- with a dedicated partition and staged updates, the system drive needs that space while the download is checked, and the partition has to be large enough for the new size once the old copy is gone.

A size that cannot be fetched this way is greyed out and says what is short. Going to a smaller size removes content; getting it back means downloading the larger size again. While a switch is under way, **Keep the size I have** stops it and deletes what had been fetched.

## More libraries: Wikibooks and Wikiversity

**Library > More libraries** lists two other collections that Kiwix publishes:

- **Wikibooks**: free textbooks and manuals, including first aid, cooking, gardening, repairs, languages, mathematics and science.
- **Wikiversity**: courses, lessons and learning material arranged by subject and level.

Each shows its real download size, read from Kiwix. **Download** fetches the newest edition with images, checks it against the published checksum and opens it. Both are small next to Wikipedia (a few gigabytes each), and the app refuses a download that would not fit on the library drive.

Once one is downloaded, a list appears at the left of the top bar. Choosing a library there changes what search, the home and random buttons, and Ask work on; the edition label on the right shows which one is open. Switching starts a new conversation, because an answer's numbered links point into one library.

Newer editions are looked for on the same schedule as Wikipedia and installed the same way: downloaded, verified, switched to, and only then is the old one deleted. **Remove** deletes a library's files and returns to Wikipedia.

These libraries live in `<library>\more\` and go wherever Wikipedia goes: moving the library, moving it onto a new partition and returning a partition all copy them too, check each copy, and remove the originals only after the switch. One partition holds all of them; there is no partition per library, because free space cannot be shared between partitions and each one would need its own headroom for updates.

**Links between projects.** Pages often link to a sister project, such as a Wikiversity lesson pointing at a Wikipedia article. When that project is downloaded and has the page, the link opens in the offline copy and the open library switches with it. When it is not downloaded, or does not have that page, the notice that normally offers to open the website says which.

## Wiki golf

A game for one to six players on one computer, played entirely in the offline copy and drawn in an 8-bit style. Press the flag button in the top bar to open the clubhouse.

**The idea.** Each hole has a start article and a target article. Get from one to the other using only the links inside the articles. Every article you open is a stroke. The fewest strokes over the round wins.

**Players.** Press **+ New player** and give the player a name, one of eight characters and a colour. Players are saved on this computer, in `%APPDATA%\Wikivault\golf.json`, with their records; nothing about them leaves the computer. Press the players who are taking part in the order they will tee off (the cards show 1, 2, 3...). A player's card, opened from the link under the list, shows the record and lets you change the name and look or remove the player.

**The round.** Choose 1, 3, 6 or 9 holes and how long they are: short (par 3), medium (par 4), long (par 5) or a mix. The game is played in whichever library is open, so open Wikibooks or Wikiversity first if you want to play there.

**How a hole is made.** The app starts at a random article and follows a few links from its text, never visiting a page twice. Where it ends up is the target, so every hole can be reached, and par is one more than the number of links it followed. Lists, disambiguation pages, categories and bare years are skipped. Before the first player tees off you can ask for a different hole.

**Taking a turn.** The hole card shows the start, the target and the opening lines of the target article. Press **Tee off** and the start article opens. A bar under the top bar shows the hole, the target and your strokes; **About the target** shows the target's opening lines again. During a turn:

- search, Ask, the home and random buttons and the library list are switched off;
- going back or forward counts as a stroke, like any other article you open;
- jumping around inside one article is free, and so is find on page (`Ctrl+F`);
- the hole ends when you reach the target, or at three times par. **Pick up** ends your turn early and scores that same limit.

When you open the target, the turn ends by itself and the result is shown.

**Several players.** Everyone plays the same hole, one after another, and the player who goes first changes each hole. The others should look away during a turn: the app hides each route until everyone has played the hole, but it cannot stop anyone watching the screen. After the last player, the hole's summary shows every route and the route the hole was laid out along.

**Scoring.** One stroke is a hole in one; otherwise scores are named against par (eagle, birdie, par, bogey and so on). The scorecard at the end lists every hole, the totals and each player's score to par. Equal totals share the win.

**Records.** A finished round is added to each player's record: rounds, won-lost-tied (counted only when more than one person played), score to par per hole, best round, holes in one, holes under par and holes not finished, and the last twenty rounds. A round that is ended early is not recorded.

**Handicaps.** After three rounds a player has a handicap: the number of strokes over par they take per nine holes, worked out from the better half of their last ten rounds, so one bad day does not move it much. Someone who plays to par or better is "scratch" (0). With two or more players, **Handicaps: On** takes strokes off each player's total in proportion to the holes played (a handicap of 9 is one stroke a hole) and the reduced "net" totals decide the winner. The scorecard shows both.

If the library is switched to a newer edition during a round, the round ends, because the articles of the old edition are no longer open.

If a turn does not end when you reach the target, `wikivault.log` has a line for the hole ("golf: hole 1 laid out...") and one for every page opened during the turn, with what the game made of it.

## The tour

A short tour opens over the main window: numbered pins on the buttons along the top, and a card that says what each one does. **Got it** closes it; it opens again at the next start. **Don't show again** stops that. The first time a new version runs it opens once more, with a short list of what is new. **Library > About > Show the tour** opens it at any time, and the tick box beside it switches the automatic opening back on.

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
| Wikibooks, Wikiversity | `<library>\more\wikibooks\`, `<library>\more\wikiversity\` (each with its own `zim\`, `downloads\` and `state.json`) |
| Settings, log, reader engine | `%APPDATA%\Wikivault\` (`settings.json`, `wikivault.log`, `engine\`) |
| Wiki golf players and records | `%APPDATA%\Wikivault\golf.json` |

## If something goes wrong

- **Nothing downloads / "Could not reach the Kiwix download server"**: check the connection and press Try again. `wikivault.log` has details.
- **The reader engine could not be downloaded**: download `kiwix-tools_win-x86_64-*.zip` (or `win-i686`) from https://download.kiwix.org/release/kiwix-tools/ and unzip it into `%APPDATA%\Wikivault\engine\`. Or set `enginePath` in `settings.json` to the full path of `kiwix-serve.exe`.
- **"Foundry Local would not keep the model loaded"**: the app already tried loading the model twice. Run `foundry service restart` in a terminal and ask again. If it keeps happening, `foundry model load phi-4-mini` in a terminal shows Foundry Local's own error.
- **"Foundry Local was not found"** right after installing it by hand: press **Set up answers** again (the app re-reads the PATH), or restart Wikivault. `foundry --version` in a terminal confirms the install.
- **Answers are slow or cut off**: lower the reading budget, or pick a smaller model.
- **Full-text search finds nothing**: it needs every word to match. Use fewer words. (Ask loosens the query automatically.)
