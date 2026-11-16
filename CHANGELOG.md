# Changelog

Every revision of Wikivault, newest first. Versions before 0.7.0 were not dated when they were made.

## 0.15.0 (2026-11-16)

- Wiki golf, fixed: on a real edition a player could reach the target and nothing happened. The target (and the start) are now also recognised by the page's title, not only by its address; addresses are compared in one normalised spelling, so titles containing a question mark, a percent sign or other escaped characters match; and category pages are no longer walked through when a hole is laid out. Every hole and every click of a turn is written to the log, with what the game made of it.
- Wiki golf, new look: the game is drawn in an 8-bit style, with a pixel course that changes from hole to hole, a ball that flies to the flag when a hole is finished, and a pixel typeface (Press Start 2P, under the SIL Open Font Licence).
- The clubhouse: players are saved on this computer with a name, one of eight characters and a colour. Each has a card with rounds played, won-lost-tied, handicap, score to par per hole, best round, holes in one and recent rounds. The round is set up there instead of in a dialog, and a finished round is added to the records.
- Handicaps: after three rounds a player has a handicap (strokes over par per nine holes, from the better half of the last ten rounds). With two or more players it can be switched on for a round; strokes are then taken off in proportion to the holes played and the reduced totals decide the winner.
- A guided tour: numbered pins on the buttons along the top and a card that says what each does. It opens at every start until "Don't show again" is chosen, opens once more the first time each new version runs (with a short list of what is new), and can be opened at any time from Library > About.
- Back now returns from the Library page to the clubhouse when that is where you came from.
- Uninstalling with "remove my data" now also deletes Wikibooks and Wikiversity. Before, their files were left behind in the library folder.

## 0.14.0 (2026-11-16)

- How much of Wikipedia is kept can now be changed after setup, under Library > How much of Wikipedia: everything with images, every article without images, or introductions only, each with its real size. The copy in use stays until the other size has been downloaded and checked, and is deleted only then. A size that cannot be fetched that way is greyed out with the reason. Until now the choice appeared only on the first-run screen, so an install that already had a library never saw it.
- Wikibooks and Wikiversity now move with Wikipedia. Move library, moving onto a new partition and returning a partition all copy every downloaded library, check each copy against its checksum, switch, and only then remove the originals. The earlier rule of removing them first is gone.
- One partition holds all the libraries. Its smallest size counts the other libraries already downloaded, and the recommended size leaves room for Wikibooks and Wikiversity and an update of each (about 20 GB more than before).
- Links from one project to another (a Wikiversity page pointing at a Wikipedia or Wikibooks page, for example) open in the offline copy when that project is downloaded and has the page, and the open library switches with them. When it is not downloaded, or does not have the page, the usual notice says so instead of only offering the website.

## 0.13.0 (2026-11-16)

- Wiki golf, a game for one to six players taking turns on the same computer (the flag button in the top bar). Each hole is a start article and a target article; the target has to be reached using only the links inside the articles, and every article opened is a stroke. Lowest total over 1, 3, 6 or 9 holes wins.
- Holes are laid out by the app: it starts at a random article and follows a few links, so every hole is known to be reachable and has a par (3, 4 or 5, or a mix). Lists, disambiguation pages and bare years are avoided as starts and targets.
- Everyone plays the same hole one after another. Routes stay hidden until all have played, then the hole's summary shows each player's route and the route the hole was laid out along. The player who tees off first rotates each hole.
- During a turn search, Ask, the home and random buttons and the library list are switched off; going back costs a stroke; find on page still works. A hole ends at three times par, which is also what picking up scores.
- A golf scorecard at the end, with totals, scores to par and shared places for ties. The game plays in whichever library is open, Wikibooks and Wikiversity included.

## 0.12.0 (2026-11-16)

- More libraries: English Wikibooks (textbooks and manuals) and Wikiversity (courses and lessons) can be downloaded from Library > More libraries. Each is verified against its published checksum, checked for newer editions on the same schedule as Wikipedia, and can be removed again with one button.
- A list at the left of the top bar switches between the libraries that are downloaded. Search, reading, the random-article button and Ask all work on the library that is open, and answers say which library they were written from.
- Each library runs its own copy of the reader engine, all on 127.0.0.1 and all under the same rule that article pages cannot reach the internet.
- Moving the library or returning the partition asks for the extra libraries to be removed first; they are not moved with Wikipedia.
- Library > About now describes the installed Wikipedia size correctly when a version without pictures was chosen.

## 0.11.0 (2026-11-16)

- Setup offers three sizes of English Wikipedia: everything with images, every article without images, or introductions only. Each shows its real download size from Kiwix and a plain verdict on whether it fits the chosen drive or partition, and whether monthly updates will fit too. The largest that fits comfortably is preselected.

## 0.10.1 (2026-11-15)

- First version published to the repository. The licence text shown by the installer now matches the repository's LICENSE file.
- Wording that referred to one particular computer removed from the documentation and tests. No change to how the app behaves.

## 0.10.0 (2026-11-15)

- MIT licence. The installer now shows the licence and a plain-language notice and asks for agreement.
- First start shows the same points once and records that they were accepted: answers can be wrong, nothing is professional advice, the app changes the computer when asked, and there is no warranty.
- `THIRD-PARTY-NOTICES.txt`, generated from the bundled libraries' own licence files, is installed with the app and reachable from Library > About.
- The IBM Plex fonts are now IBM's original files instead of reduced Latin subsets.
- "Not affiliated with Wikipedia, the Wikimedia Foundation, Kiwix or Microsoft" stated in the app, the installer and the documentation.
- Tuning progress moved directly under the Tune button: the step, an overall bar, a bar for the current action, and the action itself.
- Project documentation split into a README, a user guide and this changelog; build workflow for GitHub added (not yet run).

## 0.9.2 (2026-11-15)

- "What matters more" slider, five steps from faster answers to more thorough answers, sets the targets tuning aims for.
- After tuning, every other model download the app has made is deleted, including one that failed to run. Timings are kept.
- The Model list follows the model in use and marks it.
- A model that fails to run is skipped for 30 days. Tuning no longer downloads a larger model that the timings say would plainly miss the target.
- Models with a 4k context are left out of tuning.

## 0.9.1 (2026-11-15)

- Downloads made only for a speed test or tuning are deleted afterwards; "Remove download" on each build.
- Timings are kept across restarts and reused by later tuning runs.

## 0.9.0 (2026-11-15)

- Search ordering: title matches are merged with the engine's full-text results and come first; "List of" pages sink; a search with no match is retried without filler words and then one word short, and says which word was dropped.
- Tune for this computer: compares NPU, GPU and CPU on a small model, finds the largest model that still writes comfortably on the fastest, and sets the reading budget and answer length from measured speed.
- Memory: the model is unloaded after a few idle minutes; closing the window or quitting unloads the app's models and stops Foundry Local's background service unless another program is using it.

## 0.8.0 (2026-11-15)

- Model list read from Foundry Local's own catalogue; a table of each model's builds (NPU, GPU, CPU) with download size.
- "Find the fastest build" times each build on the same question and switches to the fastest. On the test machine the GPU build wrote five to seven times faster than the NPU build.

## 0.7.3 (2026-11-15)

- Fixed: any search with 1,000 or more matches reported no results, because the engine writes the count with a thousands separator.

## 0.7.2 (2026-11-15)

- Works with Foundry Local 0.14, whose local API differs from the published reference: new routes for loading and listing models, and a model list that is the whole catalogue, not what is loaded. Earlier versions mistook the catalogue for "loaded" and never downloaded the model.
- Finds the service through Foundry Local's discovery file.

## 0.7.1 (2026-11-15)

- A model that Foundry Local has unloaded is loaded again and the question re-sent, instead of failing with "must be loaded before inference".

## 0.7.0 (2026-11-14)

- Answer setup is part of the install: the installer offers to install Microsoft Foundry Local, the first-run screen offers to set up answers, and the Ask panel has a Set up answers button.
- The uninstaller offers to remove Foundry Local when Wikivault installed it.

## 0.6.0

- Wikipedia download split across several mirrors and connections, with resume. On the test connection the download became more than ten times faster.
- Removed the last background network request (a spell-check dictionary download).

## 0.5.0

- Moving the library and returning the partition to the main drive can be done inside the app.
- The installer upgrades in place and the uninstaller removes the app, its background processes and, on request, its data.
- Fixed: "Create partition" stayed disabled after the laptop was plugged in.

## 0.4.0 and earlier

- Downloads the English Wikipedia edition with images from Kiwix, verifies it against the published checksum, and replaces the previous edition only after the new one is verified. Checks for newer editions on a schedule.
- Desktop window with its own reader, title suggestions and full-text search, all offline.
- Ask: finds matching passages and has a local model write an answer with numbered citations. Conversation memory within one session.
- Optional dedicated partition for the library, created from a screen that shows the drive, free space and a recommended size, with confirmation.
- Staged updates: a new edition is downloaded and verified on the main drive, then copied into the partition, so the partition only needs room for one edition.
- Windows installer.
