# Changelog

Every revision of Wikivault, newest first. Versions before 0.7.0 were not dated when they were made.

## 0.28.2 (2026-11-19)

Hospitals are hospitals.

- **Why a large hospital three miles from home was missing from "hospitals near home".** It was in the data, from OpenStreetMap, with its emergency room noted. But Overture Maps files almost anything medical under "hospital": on a real download, about 36,000 of its 52,000 "hospitals" were doctors' offices, therapy practices, wards and the like. Ten of those were nearer than the hospital, and the answer lists ten.
- **A place from Overture now counts as a hospital only when its name says so** (hospital, medical center, emergency room, and the French and Spanish for them) and does not say it is an office or a part of one (a suite, a family practice, a sleep centre, a gift shop, an animal hospital). The rest are listed with the clinics. OpenStreetMap's hospitals, which are marked as hospitals by hand, are taken as they are.
- Nothing needs downloading again: the rule is applied when the places are read. On the download this was found on, the hospital in question went from eleventh to first.
- The same applies on the map's *Kind of place* list: *Hospitals* shows hospitals, and the offices are under *Clinics and urgent care*.

## 0.28.1 (2026-11-19)

The places download no longer trips over the server's daily update, and says where it stands.

- **What happened on a real run.** Sixty files were to be fetched. Six did not match the checksum beside them on the first go and four still did not on the second, so the run ended with an error; the Setup page asked again by itself, the four were fetched, and the set was complete (824,717 places) an hour later. The error line on the map page was still showing after that, and the button, rightly reading *Update the places* by then, began the whole download again when pressed.
- **Why the checksums did not match.** The server replaces every file once a day, and this run straddled that. The app asked where each file was and how big at the start of the run and trusted the answer for hours. Now it asks again just before each file is fetched, and a file that does not match is forgotten and fetched again at once from wherever the server says it is now, instead of waiting for the end of the run with the same stale answer.
- **A file that changed size under its name** is noticed and begun again, where before it could have been fetched over and over.
- **The error line clears** when a new fetch starts, so an old error cannot sit above a download that has since finished.
- **Updating a complete set asks first.** When the places are complete and were fetched in the last two weeks, *Update the places* says so, says that updating downloads every file again, and waits for a second press. *Leave them as they are* also clears away what an unfinished update had left.
- **An update that was stopped** shows *Carry on updating the places*, with how many files were read.
- The log names the copy each file came from, and both checksums when they differ, so that the next oddity can be read from it.
- A file's error is said once: "Louisiana arrived damaged", not "Louisiana: Louisiana arrived damaged".

## 0.28.0 (2026-11-19)

Ask finds the nearest places of a kind, and dragging the map no longer opens a card.

- **Why "what is the nearest hospital to home" went wrong.** Ask knew two kinds of map request: directions, and where a named person or place is. A request for the nearest of a kind was neither, so it was handed to the encyclopedia, which answered from articles about hospitals. "Where is the nearest hospital to there" was read as a place whose name was that whole phrase.
- **The nearest of a kind is now a request of its own.** "The nearest hospital to home", "which pharmacy is closest to my mother-in-law's house", "gas near me", "is there anywhere to get propane around here", "list the hospitals within a 10 mile radius of home", "how many fire stations are within twenty miles of work", "the five closest supermarkets", "hospitals in Concord", "how far is the nearest hospital". Each kind of place answers to the words people use for it (emergency room, ER, drug store, gas station, grocery, feed store and so on), and a shop can be asked for by name.
- **What the answer is.** The places nearest first, each with distance and direction in a straight line, address and telephone, and whether a hospital has an emergency room; the same places on the map's Places tab and drawn on the map; *Show on the map* and *Directions* on each row. For the first three the distance by road is worked out, and the answer says when the nearest by road is a different one.
- **"There".** In the next request, *there* is the place the last one was about: "where is home", then "where is the nearest hospital to there"; or "nearest hospital to home", then "how do I get there".
- **In directions.** "Directions to the nearest hospital" and "take me to the closest gas station" use the nearest one as the destination.
- **With no place named**, distances are from the GPS position, else from Home, and the answer says which. A town named alone ("hospitals in Concord") is the nearest town of that name, not the largest in the country.
- **Loose wording** with "nearest", "closest", "near me" or a distance in it is put to the model when answers are on, as directions already were. Questions that are not about places ("the nearest star to the sun") still go to the articles.
- **Map: dragging no longer opens the card for a spot.** The card opened on the tap that begins a tap-and-drag on a touchpad, and on a press that was held. Now it waits a moment after a single click, and anything that starts moving the map calls it off; a card that opened just as a drag began is taken away again.
- Not yet seen on the real computer: checked with stand-in places and a stand-in map. How good the lists are there depends on the places fetched, which I have not seen.

## 0.27.0 (2026-11-19)

Places come from regional extracts: minutes for the area around home, not hours.

- **Places are read out of regional OpenStreetMap extracts.** Instead of asking shared servers for the places a small area at a time, the app downloads the extract of each state or province (published daily by Geofabrik), reads the places out of it on this computer, and deletes it. The contiguous United States is 49 files and about 11 GB to download, of which a few hundred megabytes at most are kept. The reading is quick: a test file of 27 million nodes and 4 million ways was read in five seconds.
- **Nearest first, usable at once.** The files nearest your GPS position, or the place pinned as Home, come first, and what has been read can be searched while the rest arrives.
- **Carries on where it stopped.** What has been read is kept, and so is the part of a file that had arrived. A file is fetched from the dated copy the server sends on to, so a download begun one day can be finished the next.
- **Checked.** Each file is compared with the checksum published beside it, where there is one. A file that is cut short or is not an extract is refused in plain words.
- **Room while it works** is the size of the largest file, not of the whole download. The Setup page shows the download in *Still to download*, counts only what stays in the disk bar, and warns if the largest file will not fit.
- **Measure first.** *Measure the download* on the map page, and the Setup page by itself, ask the server how big the files are without downloading any.
- **The old way is still there**, under *Another way*: small pieces from the Overpass servers, with very little to download, for when the connection or the disk does not allow the large one.
- Pieces fetched the old way by an earlier version are not carried over: the new way starts afresh, and the places already in use stay until the first file has been read.
- New files: `core/osm-pbf.js` reads the extract format without any added library.
- Not yet seen on the real computer or against the real server: checked here against a small real extract (compared, thing for thing, with the standard reader), made-up extracts and a stand-in server. The file names of the 49 states and the other regions are as Geofabrik publishes them, but none has been fetched from here; a name that is wrong is reported by name, and the rest are fetched.

## 0.26.1 (2026-11-19)

The map's switches move into its key.

- **Key and layers.** The key on the map now has a tick box beside every kind of thing that can be hidden, and one for the dark map. The separate *What the map shows* list in the panel is gone. A kind that is unticked stays in the key, greyed, so it can be ticked again.
- **A plainer button when folded.** *Hide* folds the key down to a solid **Key and layers** button instead of a small underlined word.
- **A note on what it is for.** When the pointer comes near the key, a note beside it says what the key does. *Got it* puts it away until the app is next started, and *Don't show this again* for good.
- The package details name the account, not a person.
- The example addresses in the guide and in the app are New York ones.

## 0.26.0 (2026-11-19)

Places arrive sooner, an approximate destination cannot be missed, and School steps aside until it is finished.

- **School is not in this version.** It is still being built, so it is switched off in the released app: no button, no Setup row, nothing downloaded. It continues on the `school` branch and returns in a later version. School files that an earlier version downloaded are left where they are and still move with the library. The switch is one line (`wikivault.features.school` in `package.json`); one computer can turn it on for itself with `"features": { "school": true }` in its `settings.json`.
- **Places: asked for in a way the servers answer sooner.** The log of a real run showed 12 of 133 pieces arriving in an hour and three quarters, with most of the time lost to questions that were refused as too busy or ran past five and a half minutes. Pieces are now a quarter of the size, each question claims little of the server's time and memory (so it is let in sooner, and one that is too big says so within two minutes instead of five), and answers are sent compressed. The servers' rules allow one question at a time from a program, so the app still asks one of each server at a time. Pieces left unfinished by an older version are cut to the new size, and what had arrived is kept.
- **Places: nearest first, and usable as they arrive.** The pieces around your GPS position, or else around the place pinned as Home, are fetched first, and what has arrived can be searched before the rest is in. A complete set already in use still stays until its replacement is whole.
- **Directions to an approximate place say so more plainly.** When only the town or ZIP code of an address could be found, a red note above the turns says the directions do not end at the address. The end of the route has an orange ring on the map, named in the key, and with a GPS receiver the app says you have reached the approximate position, or the middle of the town, instead of "You have arrived". The amber note for a house number placed between its neighbours is unchanged.
- **A link to a GPS receiver.** *No receiver yet?* on the Setup page's GPS row and in the map's GPS box opens the shop page of a USB receiver (the GlobalSat BU-353N5, on Amazon) in the web browser. The link is kept in one file, `assets/gear.json`. The app has not yet been tried with this receiver, or any real one: so far it has only read a recorded drive.
- Not yet seen on the real computer: checked with stand-in servers. Whether the smaller questions are in fact let in sooner by the real, busy places servers is what a run on the real machine will show; the log now records how long the answers take.

## 0.25.0 (2026-11-19)

The Setup page shows sizes, progress and room; a guide for every page; a key on the map.

- **Setup: two columns of sizes.** Each row shows what is still to download as it is ticked now, and what it already has on the disk. The columns are added up under the list. Sizes that have to be asked for are worked out by the page itself, when it opens and when the choice changes.
- **Setup: progress where you are.** A row that is downloading shows a bar, what is being fetched and how far it has got, the speed, and about how long is left. Before, the detail was only on the page the download belonged to.
- **Setup: room on the disk.** A bar of the whole drive: everything else on it, what Wikivault has downloaded, what the ticked rows will add, and what stays free, with the sizes written under it. A library with its own partition is shown apart from the drive it was cut from.
- **Setup: a warning before starting.** When what is ticked needs more than is free, the page says by how much and *Download everything ticked* asks first: change what is ticked, make the partition larger, add storage, or download anyway.
- **A guide for every page.** The tour's first page now includes the Setup button, and *Walk me through the next page* goes on through Setup, Ask, Map, School, Wiki golf and Library, opening each and pointing at its parts. A new **?** button at the end of the top bar opens the guide for the page you are on.
- **Map: a key.** A small key on the map says what each line and colour stands for. It lists only what is switched on under *What the map shows*, and adds the route, saved places, places found and blocked areas while they are on the map. The same pictures are beside each switch.
- **Map: road numbers as road signs.** Interstates have the red, white and blue shield, US highways the white shield, and other numbered roads a plain white sign.
- Not yet seen on the real computer: checked with stand-in data, where downloads take seconds, so the speed and the time left have only been seen briefly.

## 0.24.2 (2026-11-18)

From a first test of the app on a real computer, with real contacts.

- The Setup page showed *Offline answers* as still to do when the model was installed and tuned but had not yet been loaded that day. It is now marked done.
- A contact's address with no house number, or with no ZIP code and a street the data lacks, was read whole as the name of a town: it got no place and a reason that made no sense. The town is now taken from how the address was read, such addresses fall back on their town, and the reason names the town and says that fetching the places adds the towns of every state.
- A source cited in an answer was missing from the list under it when two cited passages came from the same section. Both numbers are now shown on that source's row.
- In a narrow window the *Setup* and *Library* buttons were pushed off the end of the top bar. The bar now gives way in the middle.
- A place found by searching no longer takes the keyboard away from the search box, and Escape closes an open card on the map.
- An address that is found exactly is no longer followed by places that merely share its words.
- Directions: a turn that keeps to the same road says "to stay on", a road with two numbers reads "I 285 / US 52", and a new route brings its distance and first turns into view.
- In the dark map, the area beyond what was fetched is a quiet blue-grey, not black.
- The Wiki golf button marks a round in progress with a dot and a note, and is only lit on its own page.
- "Still to fetch: about 1 KB" now reads "very little".
- Map page: what is on the computer is one line that opens for the detail, so the search, the directions and the saved list come first. The side panel is wider.
- Setup, search results, School and Library are centred in a wide window.
- Contacts accounts: once an account is connected, the instructions and boxes for connecting are put away behind *Connect again or another way*.
- Checked on the packaged app with stand-in data. Not yet seen on the real computer.

## 0.24.1 (2026-11-18)

The places download, and contacts that would not go on the map.

- **The places download carries on where it stopped.** The OpenStreetMap places come from free, shared servers that are slow and often refuse. Before, the regions were asked for in large areas, one after another, with everything held in memory: one failure late in the run lost all of it. Now the regions are cut into smaller pieces, asked for two at a time (one from each server), and each answer is written to disk as it arrives. A piece that fails goes to the back of the queue. A run that fails, is stopped, or ends with the app keeps its pieces, and the next run asks only for what is missing. The Setup page shows how many pieces are here and asks again by itself a few times.
- **More contact addresses are placed.** Three things kept addresses off the map, and all three are addressed:
  - Rows of the address data that name no town and no ZIP code, or name a suburb where the contact says the city, could only be matched with the help of the list of towns from the places download. With that download failing, they were not matched at all. The app now works out where every town and ZIP code is from the address data itself (once, about a minute for a whole country) and matches by nearness to the town or ZIP code asked for.
  - An address whose street is not in the data now falls back on the middle of its ZIP code or town, marked approximate, instead of having no place. So does an address that is only a town, or a post office box.
  - A contact's address that begins with a company name or an apartment line, has the apartment on a line of its own, ends in "United States of America", or has a number like 120-A, is now read correctly.
- An entry that still cannot be placed says why. The Saved list can be narrowed to *Address not on the map yet* and *Placed approximately*.
- The app logs how much of the address data names no town or ZIP code, so the size of that gap can be seen for the data actually on the computer.
- When address data is built from now on, two buildings with the same number on streets of the same name, in rows that name no town, are both kept. Before, only one was. Address data fetched with an earlier version keeps that gap until it is fetched again.
- A route between two points that come out at the same spot on the roads says so, instead of "not a route".
- Not yet tried against the real servers or real contacts: tested with stand-in servers and made-up address rows that copy the gaps described above.

## 0.24.0 (2026-11-18)

Pins, relationships, and directions by asking.

- **Ask understands requests for the map.** "Directions from my house to my mother-in-law's house", "take me to work", "where does Dave live" are recognised, the places are found among your pins, relationships and contacts and then in the map's addresses and places, and the map opens with the route drawn or the place shown. With no start given, the route starts at the GPS position or at Home. What cannot be found is explained. Recognition is by rule and needs no model; loose wording is put to the model when answers are on. Questions that could be for the articles go to the map only when a place they name is one of your own, and every map answer offers *Search the articles instead*.
- **Pinned places.** A saved entry can be pinned as Home, Work, School, Meeting point or Other, with a name of your own. Pins are listed in their own group above the saved list and are drawn larger on the map.
- **Relationships.** A person can be given a group (Family, Friends, Work, Neighbors, Doctors and care, Other) and a tie (mother, wife, father-in-law, or your own wording). The Saved filter, the Places box and Ask all find people by it, and everyday words such as "mom" and "grandma" are understood.
- **Directions to here, directions from here.** On every saved entry, on the card of any place on the map, and on a bare spot of the map when it is clicked. The other end is then asked for: from your pins and saved list, the GPS position, typed, or picked on the map. Before, these buttons only filled in one end.
- **Filters on the Saved list**: with an address, with a place on the map, or with a telephone number only; and by relationship group. A count says how many are shown, and each row has an *Edit* button.
- Pins and relationships are kept in this app only. Setting them on a Google or iCloud contact leaves it in step with the account, and they survive the account being read again, also when its address changed.
- Fixed: the card of a saved entry opened from the Saved list closed by itself as soon as the map finished moving to it, unless a search was in progress.
- Fixed: saving an entry from its form no longer clears the e-mail address and organisation that came with a contact.
- Not yet tried on Windows with real contacts: the new parts were tested with stand-in data and the built-in test roads.

## 0.23.1 (2026-11-18)

- Google contacts can be connected with an address and an app password, the same way as iCloud, with no Google Cloud project. It reads Google's contacts (CardDAV) server. Google documents that server as needing the full sign-in but has gone on accepting app passwords; this was written from that reported behaviour and tested against a stand-in server, not against Google.
- The steps for the other way, signing in through a client of your own, now match what Google asks for: its set-up form comes first, and a client left in *Testing* works with you as a test user, with a new sign-in every seven days. Publishing it needs a home page and a privacy policy page, which the earlier text did not say.

## 0.23.0 (2026-11-18)

A Setup page, GPS, and an address book.

**Setup and downloads**
- One page, under *Setup* in the top bar, lists everything the app can fetch or set up and says for each whether it is done, to do, has an update, is working, failed, or is not chosen. What has been added since your last version is marked *New*.
- Tick what you want, choose the map's areas and detail, and *Work out the sizes* adds up what is ticked against the free space.
- *Download everything ticked* fetches the lot, one thing after another, and carries on after a restart. A failure in one does not stop the others. The offline answers are set up alongside and then tuned to the computer.
- The page opens by itself on a new installation and once after each update, with *I'll do this later*.
- School books, the map and its data can now be fetched as soon as the library has a home, while Wikipedia is still downloading.

**GPS**
- A USB receiver is found by trying every serial port at the usual speeds. The position is shown on the map and can be the start of a route.
- Turn by turn: a banner gives the next turn and the distance to it, a new route is worked out when the route is left, and the turns can be spoken.
- A journey that starts away from any road (a car park, a field) is not treated as off the route until it has reached it.

**Address book**
- The *Saved* tab of the Map keeps people and places, placed on the map from their address, or by hand.
- Saved entries are found by name in search and in directions, and any place on the map can be saved.
- Contacts are read from Google (sign-in in your browser, with a client you register once) and from Apple iCloud (app-specific password), and from vCard or CSV files. They are read again by themselves, once a day by default. Sign-ins are stored encrypted by Windows.

Also fixed: the list of Wikipedia sizes on the Library page could miss the mark on the copy in use after the library was moved.

What could not be checked from here, and so is untested against the real thing: a real GPS receiver on a real serial port (the reading of sentences, the route following and the re-routing were tested with a recorded drive), Google's sign-in and People service, and iCloud's contacts server (both were tested against stand-in servers written from their published behaviour).

## 0.22.0 (2026-11-18)

Library: the partition can be managed after setup.

- **How full it is.** The Partition section of the Library page shows a bar with the space in use and free, and how much of it the library itself takes.
- **Change the size.** Choose a new size between the smallest that holds the library and the largest the Windows drive can give. Windows cannot stretch a partition towards the drive in front of it, so the app does it by steps it already had: the library moves to a folder on the Windows drive, the partition is removed, a new one is made at the chosen size, and the library moves back. Each copy is checked before the app switches to it, and the library stays usable throughout.
- **Give the library a partition at any time.** Before, this could only be done ahead of the first download. Now a library that lives in an ordinary folder can be moved onto a new partition from the Library page.
- If a step fails, the library is whole wherever the last finished step put it, and the message says where. If Windows can free less than expected, the partition is made as large as Windows allows, when that still holds the library.
- A partition that exists without the library on it now offers *Move the library onto drive W:* beside *Remove drive W:*.
- The boxes for moving the library and for leaving the partition now count the whole library (Wikipedia, other libraries, School, the map and its data) when they say how much room is needed. They counted only Wikipedia, though the move itself already checked the full amount.

No new disk operation was written for this: only the two that were already in the app, making the partition and removing it, are used, in a new order. The sequence was tested with the pretend drive the tests use. It has not been run on a real disk from here.

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
