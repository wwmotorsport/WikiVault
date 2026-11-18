# Changelog

Every revision of Wikivault, newest first. Versions before 0.7.0 were not dated when they were made.

## 0.21.0 (2026-11-18)

Map: street addresses, and more places, from Overture Maps.

- **Addresses.** Under *Change or update*, *Addresses and more places* measures and then fetches the address points for the regions you ticked. After that an address can be typed in the Places box or as the start or destination of a route: `350 5th Ave, New York, NY`, with or without commas, ZIP code or state. Street names are matched however they are written (Fifth Avenue, 5th Ave).
- **A best guess when the exact address is not known.** If the number is not in the data, it is placed between the nearest known numbers below and above it on the same street, on the same side where it can tell. With only one neighbour it points at that neighbour. If the street is known but not in that town's rows, the town's own position is used to find it. If the street is not known at all, the result is the town. Each of these says *Approximate* and why, in the results, in the pop-up on the map, and above the directions.
- **More places.** Places from Overture Maps (Meta, Microsoft, Foursquare and others) are added in the kinds the app already has, but only where OpenStreetMap has no place of a like name within 150 metres. They are marked as coming from Overture, since they are less checked.
- Overture's files are large and sit on fast servers, so this is far quicker than fetching places from OpenStreetMap's shared server. Only the groups of rows that touch your regions, and only the columns used, are downloaded. A fetch that is stopped carries on from the files it had finished.
- The reading and sorting runs on its own thread, so the map stays usable meanwhile.
- The address index is one file, `addresses.dat`, in the library's `maps` folder.
- Fixed: moving the library after using directions could leave the old map and routing files behind on Windows, because the app still had them open. The map file is now closed first, and the removal waits for the routing engine to let go.
- Fixed: after a move the app could jump to the reader without saying where the library now is. It stays on the Library page and says so.

What this build could not check from here: the real Overture servers. The file layout, the listing and the row format are written from Overture's published schema and documentation, and tested against stand-in files of the same shape. Three things are guesses until a real fetch has run: how long it takes, whether Overture's current names for kinds of place match the list in the app (they renamed about four hundred in 2026; the app matches loosely and keeps a tally of the kinds it passed over, in `overture.json`), and how complete the addresses are in each state.

Not in this build: Census address ranges. Interpolation uses known neighbouring addresses only, so a street with no address in Overture at all falls back to the town.

## 0.20.0 (2026-11-18)

Map: a clearer look, a choice of what it shows, and a fix for a crash while downloading routing data.

- Fixed: downloading the routing data could stop with a box headed "A JavaScript error occurred in the main process" (`assert(!this.paused)`). The server had closed the connection part-way through a large file, and Node's built-in `fetch` fails an internal check when that happens instead of reporting an error. Every map download (the map, the places, the routing data) and the requests to the routing engine now go through the app's own HTTP code, where a closed connection is an ordinary error: the file carries on from the byte it reached, as many times as it takes while it keeps making progress. Files already fetched whole are kept, so pressing download again continues where it stopped.
- A routing file's connection is given up on after a minute with no traffic and tried again, where before it could wait five.

- Colours that tell things apart. Highways are orange, main roads amber, streets white with a firm edge, tracks and paths brown and dashed, railways dark. Woodland and parks are clearly green, water clearly blue, buildings tan, borders purple. Before, the roads were white on pale grey.
- Roads are drawn heavier, each kind by its own amount, and grow with the zoom: highways most, then main roads, then streets. Highways stay visible with the whole country on screen.
- *What the map shows*, in the Map panel: switch off woodland, parks and land use; water; buildings; streets, tracks and paths; railways; borders; road names and numbers; names of towns and places; and the small symbols for shops and sights. Highways and main roads always stay.
- Dark map: the same map on a dark ground, for a dark room or a night drive. The route, the blocked areas and the places found are recoloured to match.
- The look you choose is kept between runs.

The crash could not be reproduced from here: the tests cut a download again and again and check that the file still arrives whole, but the real server's behaviour is known only from the error box. The looks were checked as valid map styles and drawn in the tests on stand-in tiles. They have not been seen on the real map of the United States from here, so colours and weights may want tuning once you have looked at them.

## 0.19.0 (2026-11-18)

Map: directions. The second of the four stages.

- Directions between two points, with turn-by-turn steps, the distance and an estimate of the time. A point can be a place or town found by name, coordinates typed as "35.22, -80.84", a click on the map, or "Directions from here" and "Directions to here" on any place.
- Five ways of travelling: car; car with farm and forest tracks allowed; bicycle; bicycle off road; on foot. For cars, motorways can be kept off.
- Blocked roads and areas. Mark a spot on the map and choose how far around it is closed, from 200 yards to 100 miles; the route is worked out again around every block. Blocks are listed and can be removed one by one.
- Another route: up to three alternatives to the best one.
- The routing data is measured before it is downloaded, like the map: one file for each five-degree square of the regions ticked. A stopped download carries on; the data in use stays until the new set is complete.
- The engine is BRouter 1.7.10, an open routing engine that works entirely on this computer. It is included, compiled from its release source, and runs only while directions are in use, listening on this computer alone.
- BRouter is a Java program, so a Java runtime (Eclipse Temurin 25.0.5) is now installed with Wikivault, in its own folder. It is not registered with Windows and nothing else uses it. The installer is about 30 MB larger.
- Road names in the steps are read from the map, because the routing data holds none. With a map at "Every street" or more, turns are named; with less detail, some or all steps read "Turn left" without a name, and the route says so.
- Places and Directions are now two tabs in the Map panel.
- Fixed: the map download could refuse a very small map file.

Street addresses cannot be searched yet; that is the next stage, together with more places from Overture Maps.

Tested with the real engine: BRouter itself, built from the same source, routing on a small set of test roads made with BRouter's own data tools, on Linux and, with the Windows Java runtime that is shipped, under Wine. Not tested, because the build environment cannot reach it: the routing data server (brouter.de), the real files' sizes and download speed, and routes over real roads. Times are the engine's estimates for open roads.

## 0.18.0 (2026-11-18)

Map, a new section (the folded-map button in the top bar). This is the first of four stages: the map and the places on it. Directions, address search, updates on a schedule and sending maps to a phone come later and are not in this version.

- An offline map for the regions you tick: the contiguous United States, Alaska, Hawaii, Puerto Rico and the U.S. Virgin Islands, southern Canada, Mexico. It shows roads, towns, water, woodland and open land, and it is drawn by the app itself from one file in the library.
- Measure before you download. The map is cut from the Protomaps world basemap, a file of about 140 GB built daily from OpenStreetMap. The app reads only that file's index, lists what each level of detail would take for your regions (from "highways and cities" to "everything"), and downloads nothing large until you pick one. Then it fetches just those parts of the world file.
- A map download that is stopped or interrupted carries on where it was. A new map replaces the one in use only when it is complete and has been checked.
- Places, fetched from OpenStreetMap: hospitals, clinics, pharmacies, medical supply, veterinary; fire, police and ambulance stations; water and wastewater works, water towers, drinking water points, springs and wells; power plants, substations, fuel and bottled gas; supermarkets, wholesale clubs and food banks; department, hardware, farm supply, outdoor and gun shops; airfields, rest areas, campsites and ranger stations; military sites, town halls and courthouses; cities, towns and villages.
- Find a place by name, street or town, or pick a kind of place and see those in view, nearest the middle of the map first. A place opens with what OpenStreetMap records for it: address, telephone, hours, who runs it, and details such as whether a hospital has an emergency room.
- The map and places live in the library folder under `maps\`. They move with Wikipedia, count toward the size of a dedicated partition, and are removed by the uninstaller when you choose to remove your data.
- The app's own window may now read from the app's local address, and only its map paths; everything else stays blocked as before.
- MapLibre GL JS, PMTiles and the Protomaps basemap style (all BSD 3-Clause), Latin ranges of Noto Sans (OFL) and a small icon sheet (MIT) are included.
- The tour has a stop for Map.

Not tested, because the build environment cannot reach them: the Protomaps build server and the OpenStreetMap places servers. Measuring, cutting, resuming, drawing and searching were tested against stand-ins that hold real vector tiles and answer the way those servers do, and the cut file was read back with the PMTiles project's own reader. The real sizes, the real speed and the real number of places will be known when it first runs on a real connection. Drawing was tested with software graphics, not a graphics card.

Limits to know. Places are what volunteers have mapped: good for hospitals, fuel and shops in towns, thinner in the countryside, and never a list of what is in stock. There is no layer for public and private land yet. Updating is by hand: Map, Change or update.

## 0.17.0 (2026-11-17)

- Guided lessons. Every day of the School plan has a **Start lesson** button. It opens the lesson as steps beside the book: get ready, each part of the lesson in order with its time, then check the work and finish. Next and Back move through the steps, and the book turns to the page of each one. Any step can be picked from the list. A step with a time has a timer. Buttons switch the book between the teacher guide, the student pages, the reader and the answer key. Finishing ticks the lesson in the plan and offers the next lesson of that day.
- The steps are read from the teacher guides themselves. Language arts lessons give their parts (reading, writing, grammar and so on) and the timed activities inside them; mathematics lessons give the warm-up, the activities, the lesson synthesis and the cool-down; history chapters give the core lesson, the check for understanding and the optional activities; science lessons give their numbered steps, split by day when a lesson takes more than one.
- A science unit planned by days now follows its guide: a lesson the guide gives two days takes two days of the plan, and the days after the last lesson are the unit's review and assessment.
- Lessons show their names in the week ("Lesson 2: Measure Volume"), and a lesson's big question is shown where the guide states one.
- Page finding was rebuilt on the real files. Lesson pages come from the guides' own lesson headings and running heads. In a book that holds several units, a unit's test and answer key are its own. Readers open at the chapter a lesson names.
- Several of the mathematics guides use fonts whose letters do not all come out as text. Their lesson parts are recognised by shape and order, and their lesson titles are taken from pages that do read. Where a step's own title cannot be read it is shown as "Activity 2" without one.
- A file whose name has an accented letter is asked for in both spellings of that letter before it is counted as failed. (One activity book, for the first language arts unit, did not arrive in the first real download.)

Checked against the text of the 104 Grade 5 files of a real download: all 485 lessons and chapters of 38 of the 39 units are found, with 2,541 steps between them (2,193 with a time), and 504 of the 569 days of the plan get steps read from their guide. The rest are tests, review days and the one unit (the end-of-year novel study) whose guide is not divided into lessons; those get three general steps. Not checked: whether each step's page is right to the eye, since only the text of the pages was read, not the pages as printed.

## 0.16.0 (2026-11-16)

- School, a new section (the open-book button in the top bar): Grade 5 as a full year of lessons, laid out in 36 weeks of five days and two semesters. It uses the Core Knowledge Foundation's free curriculum for four subjects: Language Arts (CKLA), Mathematics (CKMath, built on Illustrative Mathematics' IM K-5 Math), History and Geography (CKHG) and Science (CKSci). The plan and what each unit teaches are part of the app and can be read before anything is downloaded.
- One button downloads the 105 PDF files from coreknowledge.org into the library: teacher guides (lesson plans, tests and answer keys), student books and activity pages, and readers. The files are kept exactly as published.
- Every page of every file is read once and its text kept in a plain index. That index is what makes the books searchable, and what the app uses to find, for each day, the page of the lesson plan, the student pages, the reading, the answer key and the test. A link opens the book inside the app at that page; when no page was found it opens at the start.
- The week: what each subject covers, then each day's lessons with their links and a tick box. The year: every unit with its weeks, its days done, its files, and a box to skip it (the rest of that subject then spreads over the year). Ticks and skipped units are kept in the library.
- Books and supplies: the few things the lessons need that are not free (three trade books, one publisher workbook, science materials), what is optional, and what each is for. Nothing is bought or ordered by the app.
- Books I have added: PDFs you own can be copied into the library. They are searched with the rest and move with it.
- The school files live in the library folder under `school\`. They move with Wikipedia in every kind of move, count toward the size of a dedicated partition, and are deleted by the uninstaller when you choose to remove your data.
- The tour has a stop for School.
- The reader can now show PDF files from the app's own local address. Requests to anywhere else are still cancelled.
- PDF.js 3.11.174 (Mozilla, Apache 2.0) is included to read the text of the PDFs. It does not draw them; the app's own built-in viewer does.

Not tested, because the build environment cannot reach coreknowledge.org: the real downloads and their total size, and how well the pages found for each lesson match on the real books. Both were tested against stand-in files written to resemble the publisher's layout. Visual Arts and Music, which the same publisher offers for Grade 5, are not included yet.

## Repository, 2026-11-16 (no change to the app)

- The installer is easier to find: a download link at the top of the README and in `DOWNLOAD-INSTALLER.md`, with step-by-step instructions from finding the file to the first article, in the README and in the user guide.
- The build on GitHub now starts for tags written `v0.15.0` or `V0.15.0`, attaches only the installer to the release, and then points the download links at it. It can also be run by hand for a release that already exists.

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
