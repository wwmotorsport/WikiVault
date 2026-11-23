# Changelog

Every revision of Wikivault, newest first. Versions before 0.7.0 were not dated when they were made.

## 0.39.0 (2026-11-23)

Setup in one pass, an install of the answer model that recovers by itself, and Ask that follows a question to the library that has it.

- **Setup shows sizes at once, and measures only when asked.** The downloads list used to start asking the servers for sizes whenever something was ticked. While that ran the list was redrawn again and again, and each time the page jumped back to the box that had been ticked, so the rest of the page could not be reached. Now every row shows an estimate straight away (marked *about*), taken from a real installation and the servers' own listings in November 2026, and the totals and the disk bar follow each tick as it is made. Nothing is measured, and nothing moves, until you choose: *Measure the true sizes before downloading* replaces the estimates with what the servers say today, and *Download directly with offline estimates* starts everything ticked without measuring. The estimates are good for the usual choice (the contiguous United States at the two finest levels of detail) and rougher for other areas; a coarser map has none and says *not measured*.
- **Fixed: the page jumped while the list was redrawn.** The place of the keyboard is put back without moving the page, and the page's own position is kept.
- **Fixed: "winget could not install Foundry Local ... Not found (404)".** For a while after Microsoft publishes a new version of Foundry Local, winget can point at an installer that is not there. The app now refreshes winget's list and tries again, and if the newest version is still missing it installs the one before it (up to four are tried). If none can be had, the message says so in plain words and that the rest of the app works meanwhile.
- **Ask follows the question.** When the open library has nothing on a question, Ask no longer stops there: it asks the library on this computer with the most matches, answers from it, says that it did (*Nothing in Wikipedia matched that question, so it was asked in Survival Guides, which is now the open library*), and makes that the open library so that the links and any follow-up belong to it. The buttons for the other libraries with matches stay under every answer.

## 0.38.0 (2026-11-23)

Ask says what the other libraries hold, an external drive is checked before it is used, and a missing library drive is said to be missing.

- **Ask no longer lets one library stand for all of them.** Ask reads the library that is open. When it finds nothing, the message used to say that nothing in "this edition" matched, as if nothing on the computer did. Every answer now comes with a quick look in the other libraries: when they have matches, buttons under the answer say which (*Ask in Survival Guides (5 matches)*), and pressing one opens that library and asks the same question there. When Ask does answer, it says the answer is from the open library only and lists the others with matches the same way.
- **Libraries Ask cannot read are named.** Two libraries are copies of web sites whose substance is PDF documents (*US Army publications*, *Survivor Library*). Search and Ask cannot read inside those documents. Their descriptions say so, and when either is on the computer every answer ends by saying it was not looked in, and why.
- **Military medicine manuals are now converted.** The Kiwix file is a copy of a web page with two dozen PDF manuals behind it; opened as a library, Ask could see the one page and none of the manuals. It is now a collection of the Survival Guides: the app finds the PDFs inside the file, titles each by the link that leads to it on the site (or by the title written in the PDF), and converts them like the rest, scanned pages read for their words. A copy added as a library in 0.37 is removed by itself; add the collection in its place.
- **Survivor Library** can be added: a very large collection (about 205 GB) of old books on farming, building, trades and medicine, as scanned PDFs. It opens and is browsed by subject; it is not converted.
- **An external drive is checked when it is chosen.** Choosing a folder for the library, at setup or in *Move library*, the app asks Windows what kind of drive it is on. For a drive plugged in by USB (or a card, or a network folder) it says so, times the drive for about ten seconds by writing to it, and says what it found: good, workable but slower, or too slow, with the speed measured. For a drive that is not good enough it says what to look for instead (a portable SSD, the kind of port and cable, how large). A drive formatted FAT32 is refused outright, because it cannot hold a file as large as Wikipedia.
- **The library drive is not connected.** If the library's folder cannot be reached when the app starts, the app says so in place of looking like a new installation: it names the folder, makes nothing in its place, looks for the drive every few seconds, and opens the library by itself when the drive is back. Setting up somewhere else is offered behind a second confirmation.
- **Fixed: text recognition did not start, and froze the app (0.37).** The recognition engine comes in several builds, and the installer left out the ones it actually loads, so on an installed copy it failed on the first scanned page. Worse, it was tried again for every page, and each try left a worker running: with a few hundred of them the window stopped responding. The right files are now packed; a reader that cannot start is tried once and then left alone, with one line in the log, and the pages are kept as pictures. The test that should have caught this ran the built app from inside the project folder, where it could borrow the missing files; it now runs from a copy outside it.
- **Not yet: the Army manuals as articles.** Converting them needs more than this build has. The set is 7.7 GB of PDFs, and the guides' search keeps the text of every article in memory, which is right for hundreds of megabytes and wrong for that much. It needs a search index kept on disk first, which is the next piece of work. Until then *US Army publications* remains a library whose manuals open as PDFs.

## 0.37.0 (2026-11-23)

Scanned pages are read for their words, your own books can be added, and more libraries are offered.

- **Text recognition for scanned pages.** A page of a guide that is a scan with no words behind it used to be shown as a picture that could be read but not found. Its words are now read from the picture when the guide is converted, so the page is found by search and used by Ask; it is still shown as the picture, with the words under it, and the link to the same page of the original. The reader (Tesseract, with its English data) is packed with the app: nothing is fetched and no page leaves the computer. It takes a second or two a page.
- **Collections converted by 0.36 can be brought up to date.** A collection with scanned books whose words were never read says so and has a *Read its scans* button. It converts those books afresh from the PDFs that were kept; nothing is downloaded again.
- **Your own books.** Under *Survival Guides*, *Your own books* takes PDF files (scanned or not), or a folder of photographs or scans of pages (JPEG or PNG, named in page order; a photograph taken with the camera turned is stood upright). Each becomes a book in a collection called *My books*, converted, read and searched like the rest, and each can be removed. Nothing you add leaves the computer.
- **More libraries to add.** Twelve more from Kiwix, each optional: *Military medicine manuals*, *Ready.gov*, questions and answers on the *outdoors*, *cooking*, *amateur radio*, *vehicle repair*, *gardening* and *home repair*, *iFixit repair guides*, *Energypedia*, *Gardenology* and *US Army publications*. They are ordinary Kiwix libraries: fetched, checked, opened, searched and updated like Wikibooks. Army publications is a copy of the Army's publications site, and its manuals open as PDFs; they are not converted into articles.
- **Everything optional is in the one list.** The Survival Guides and every library above have a tick in the downloads list at the top of *Options and Setup*, so the one button fetches whatever is ticked.
- **Fixed: a contacts list made by hand was not read.** A CSV file was understood only with the column names Google and Outlook write. A plain list is now read too: *Name* (or first and last name), *Address* or *Full Address* (alone, or with town, state and ZIP code in their own columns), *Phone*, *Email*.
- **Fixed: addresses that landed in a contact's note.** A list uploaded to an account can put each address in the note instead of the address. When a contact has no address and its note is one, the note is used as the address. This holds for Google, iCloud and files.
- **Import says what it left out.** After an import, the message says how many contacts were left out for having neither an address nor a telephone number, and how many addresses came from notes.

## 0.36.0 (2026-11-23)

Survival Guides: a library of practical guides, made on this computer from the PDF collections Kiwix publishes.

- **A new library: Survival Guides.** Under *Options and Setup > More libraries*. Five collections can be added, each on its own: *Water*, *First aid and medicine*, *Food*, *Knots* and *After a disaster*. Kiwix publishes these as bundles of PDF documents, which its own reader can only list and open; no words inside them can be searched. Wikivault fetches a bundle, checks it against its published checksum, and converts every document into articles.
- **Text as text, pictures as pictures.** The words of each page become headings, paragraphs and lists in reading order (columns read one after the other, running heads and page numbers taken out, words broken at a line's end mended). Every photograph, drawing, diagram and table is cut out of the page as an image file and put in the article where it stood, the way pictures sit in a Wikipedia article. A page that is a scan, or more picture than text, is shown whole as a picture of itself, with the words read from it underneath so that it can still be found.
- **Long documents become several articles.** By the document's own table of contents where it has one, otherwise by its large headings, otherwise every ten pages or so. Each article links to the one before and after, and to the guide's contents.
- **The original is kept.** Every article has small page numbers in the margin and a link at the foot; each opens the original PDF at that page. Where the conversion is not good enough (a dosage table, a fine drawing), the document as printed is one click away.
- **Searched and asked like Wikipedia.** Survival Guides appears in the library list at the top. With it open, the search box suggests titles and searches the full text, and Ask finds its passages there, answers from them and links to the articles. (Wiki golf stays with the other libraries: it is played from link to link, and guides do not link to one another.)
- **On this computer.** Converting is done here, in a window that is never shown and that can reach neither the network nor any file; nothing inside a PDF is run. It takes a few minutes for a small collection and can be left to run while the app is used. If the app is closed part way, it carries on from the last finished document. The bundle is deleted once converted; the PDFs, pictures and text take two to two and a half times the size of the download.
- **Not professional advice.** The first page of the library and every article of the medical collections say so.
- **Two more libraries to add.** *Appropedia* (practical know-how for water, sanitation, food, building and energy) and *Medical encyclopedia (MDWiki)* (the medical articles of Wikipedia kept by WikiProject Medicine) are offered beside Wikibooks and Wikiversity. They are ordinary Kiwix libraries and work like the others.
- **Not yet:** the Survival Guides are added from *More libraries*, not by the one button at the top of the page, and collections are not checked for newer editions by themselves.

## 0.35.0 (2026-11-23)

Smoother live navigation, a map that can turn with you, and a record of where you have been.

- **The mark glides.** A receiver reports a position about once a second, and the mark used to jump from one to the next. It now moves steadily between them, and the map moves with it. A jump of more than a quarter of a mile (a reading after a tunnel, say) is still shown at once.
- **North up, or the way of travel up.** A choice in the GPS panel, under *Keep the map on my position*. With *Way of travel up* the map turns as you do, and the mark sits lower on the map so that more of the road ahead shows. The map turns only while it is following your position and you are moving; standing still, it stays as it was. Dragging or zooming the map by hand pauses the following for a few seconds. The choice is remembered.
- **Breadcrumbs: a record of where you have been.** Off until you switch it on, with *Keep a record of where I go* in the GPS panel or on the new *Trips* tab. While it is on and a receiver is connected, positions are kept as you move (not while standing still). A stop of five minutes, or a reconnected receiver, ends one trip and begins the next. The record is kept on this computer only, in the app's own data folder; it is never sent anywhere, and positions are not written to the log.
- **Where I have been, on the map.** A layer of its own, with a switch in the key and on the *Trips* tab, drawn as connected lines or as separate dots, whichever you choose. The trip being driven grows behind the mark.
- **Trips.** A fourth tab beside *Places*, *Directions* and *Saved*. Each trip is listed with its day and times, where it began and ended, its length and how long it took. A trip can be found by a town it began at, ended at or passed, and by a range of dates. Press a trip to see it alone on the map; delete one trip, or all of them, each after being asked once more. Towns are named from the places on the map, so they need the places download.
- **End trip.** A button on the turn banner at the top of the map, and in the GPS panel while a route is being followed, ends the trip without disconnecting the GPS: the route and its turns go, the map keeps showing where you are, and the places you chose stay in the From and To boxes so that *Get directions* takes the trip up again. (*Clear*, in the Directions panel, still empties the boxes as well.)
- **Fixed: the GPS panel could run under the next turn.** With a trip under way the panel is now kept clear of the banner at the top of the map, and scrolls if it has to.

## 0.34.1 (2026-11-22)

Finding the GPS receiver no longer depends on luck.

- **Fixed: the receiver was found only on some tries.** Both *Find my GPS receiver* buttons run the same search, and it could fail several times and then succeed with nothing changed. A serial line makes small mistakes, most often a character cut in half because the port was opened in the middle of it. The browser reports each one as an error and then offers a fresh stream on the same port; the search took the first such error for a silent port and moved on. A receiver that sees many satellites at 4800 baud never pauses between sentences, so nearly every opening lands inside a character, and the search succeeded only when it happened not to. The search now reads past these mistakes, and counts them in the log.
- **Fixed: the same mistake could drop a receiver that was connected.** A full buffer or a damaged character while driving ended the connection as "the receiver stopped answering". These are read past as well, and the port is opened with a much larger buffer so that a busy moment does not overflow it. Only a port that is really gone, or one that produces nothing but mistakes, is given up on.
- **In the log.** How many mistakes were read past when a receiver was found, and when it was lost and why.

## 0.34.0 (2026-11-22)

A GPS panel on the map, and a receiver that is set up once.

- **A GPS panel in the corner of the map.** In the bottom right corner, the twin of the key in the bottom left. Folded, it is a button with a lamp that says whether a receiver is connected: green when it has a position (with your speed beside it), amber while it is connected and waiting for a position or being looked for, red when it was lost, grey when there is none. Open, it shows your speed, heading (when moving), position, how sure the position is, height, satellites in use, the time from the satellites and the receiver's port, with the controls that are also in the Directions panel: find, disconnect, start from my position, show where I am, keep the map on my position, speak the turns. On a trip it leads with the next turn, the distance left and the time you should arrive. It folds away while the map is waiting for a click, and remembers whether you left it open.
- **Set up once.** A receiver that has worked is remembered (which USB device, and at what speed). From then on it is connected by itself when Wikivault starts and whenever it is plugged in, straight at the speed it worked at, and only that device's port is opened. Its row on the Options and Setup page turns to *Done* and stays so. *Disconnect* leaves it alone until you ask for it, plug it in again, or next start Wikivault. A receiver connected with 0.33.1 is picked up once and remembered.
- **What was wrong on 0.33.0.** The first real receiver the app met was not found by 0.33.0 and was found at once by 0.33.1, on the same port with the same driver. No driver was missing; the cause turned out to be in how the port was read, and is fixed in 0.34.1.

## 0.33.1 (2026-11-22)

Finding a GPS receiver: the app says what it found, where you can see it.

- **Fixed: the answer was out of sight.** *Find my GPS receiver* did answer, but in a box at the very bottom of the Directions panel, under the turns of whatever route was showing, so pressing the button looked like nothing happening. The GPS box is now directly under *Get directions*, above the route, and is brought into view when a search starts and when it ends. The row on the Options and Setup page shows the result too.
- **It says why.** "Nothing is sending GPS positions" did not tell a receiver with no driver from one that is not plugged in. When a search fails the app now asks Windows about its ports (read-only, on this computer) and says which it is: the ports found belong to Bluetooth or the computer and the receiver has none of its own; Windows can see a USB device it has no driver for, named, which is most likely the receiver; or the receiver's port is there and would not open, stayed silent, or sent something that is not GPS sentences.
- **A more patient search.** A receiver's port is listened to for longer at each speed (at 4800 baud one second's worth of sentences takes most of a second to arrive), two more speeds are tried on USB ports, and the port is told the computer is ready to listen, which some USB-to-serial chips wait for.
- **In the log.** The ports Windows knows, what each port did at each speed, and the conclusion are written to the log, as is the port and speed a receiver was found at.

## 0.33.0 (2026-11-20)

Addresses the downloaded data cannot place can be looked up online, once you say yes.

- **Looking addresses up online.** The free address data does not cover every county, so a contact with a complete address could end up placed only at its town, or not at all. When there are such addresses the address book now asks, once, whether it may look them up with the United States Census Bureau's free address service. After a yes, they are looked up in one request whenever there is a connection (after a contacts account is read, an entry is saved, or the address data changes) and put on the map. What is found is kept, so each address is asked about once and works offline from then on.
- **What is sent is the street address and nothing else:** no name, telephone number, e-mail or note, and nothing from entries the downloaded data can already place. It goes in the body of the request, never in a web address, and nothing about it is written to the log. Until you say yes nothing is sent, and the line under the address book's summary switches it off again. This is the first thing the app can send from your own data, which is why it asks.
- **How good the result is.** The service places a number along its street from the range of numbers on the block: the right stretch of road, usually within a few doors. Such an entry says *Looked up online*, shows the address as the service read it (small misspellings are corrected), and is no longer counted as approximate. A house the downloaded data knows, and a place set by hand, are always used in preference. On a real address book, 13 of the 14 addresses that qualified were placed.
- **Limits.** United States and Puerto Rico only. Post office boxes and addresses with no house number are not sent. An address the service does not know is tried again after a month.
- **Fixed: a town placed in the wrong state.** When an address named a town and state whose addresses had not been downloaded, the town-level fallback could pick a town of the same name elsewhere: a Springfield in one state could be put at the Springfield of another, hundreds of miles away. A town is now only ever placed in the state the address names, and when no such town is known there the entry is left unplaced, with the reason.
- **Fixed: the bar for the ready-made places.** While the ready-made set was being fetched, the bar on the Options and Setup page and in the Map panel slid a thin strip from side to side and showed no speed or time left, because that download did not hand the page its size. It now fills as the bytes arrive, with the speed and the time left beside it, and fills again by files while the places are read in.

## 0.32.0 (2026-11-20)

Setup and Library are one page: Options and Setup.

- **One page in place of two.** The *Setup* and *Library* buttons at the top are one button, **Options and Setup**. The page holds everything both had, in six groups: *Downloads* (the list with its ticks, sizes and one button), *The library and where it is kept* (the edition, its folder, moving it, the partition), *Wikipedia: updates and size*, *More libraries*, *Answers from the local model*, and *About*.
- **Each group folds, and its heading says how it stands:** *Complete*, or what it still needs (*3 to fetch*, *Needs setup*, *A newer edition is ready*), or *Optional* and *Switched off* for the things that are a choice. The first time, the groups that need something are open and the complete ones are folded; after that each stays as you left it.
- Anything in the app that used to send you to the Library page (the edition's name at the top, "there is not enough room", the guide) opens this page at the library's group.
- The page works out download sizes by itself only when you come to it by its button, not when something else brings you to the library's settings.
- The guided tour has one stop for the page where it had two.

## 0.31.0 (2026-11-20)

One list and one button for the map's downloads.

- **"Places" is one thing.** There were two rows, *Places* (from OpenStreetMap) and *Addresses and more places* (from Overture), which was the app's plumbing showing through. Now there is one row, *Places: hospitals, fuel, shops, towns and more*, on the Setup page and in the Map section. It fetches the ready-made set, which holds both sources. When the set cannot be had, the same row builds OpenStreetMap's places on the computer and then fetches Overture's, without being asked. *Street addresses* stay a row of their own: they are large, and many people will not want them.
- **The Map section has the Setup page's list.** Under *Change or update*: the regions, then *What to download* with a tick for the map, directions, places and street addresses, what each will take, the detail of the map, and one button, *Download everything ticked*. It fetches one thing after another, each from the quickest place it can be had, and leaves alone what is already here. The regions ticked there and on the Setup page are now the same choice.
- **Advanced map download settings.** Everything that was on the panel before (measuring each part, choosing a level of detail, fetching one thing by hand, building the places from extracts or in small pieces, Overture's places on their own) is folded under that heading. It stays open for those who use it.
- **A newer ready-made set is offered.** When the places on the computer were built here, or the ready-made set is a month newer than the one in use, the row says so and the one button fetches it.
- **The warning before updating complete places says what will happen:** the ready-made set is fetched again, with its size and date, where it used to speak of downloading every regional file.
- Street addresses still come straight from Overture Maps, not from GitHub. For places, building once saved every user 13 GB; for addresses there is no such saving, because what is fetched is already about what is kept (gigabytes), and hosting a copy would only add a second place for it to go stale.

## 0.30.1 (2026-11-20)

The first real build of the ready-made places, and what it showed.

- **The ready-made set is live:** 66 MB in 56 files, holding 834,624 places from OpenStreetMap and 992,290 from Overture Maps (release 2026-11-18.0) for the United States, Canada and Mexico, and Medicare's 5,435 hospitals. Fetched and put to use for the contiguous United States in 25 seconds on a test machine. The build took 70 minutes on GitHub's servers. Of Overture's places, 299,000 were settled by brand, 606,000 by Overture's exact kind and 87,000 by name; gun shops went from 12 to 11,259, and ambulance stations and medical supply shops, which had received nothing, got 6,614 and 10,611. The hospital list found 4,808 of its hospitals among the places and took 917 of them back from the clinics.
- **What it showed was wrong, now put right** (in the set from its next build): therapy practices filed as children's hospitals were trusted on their kind; doctors listed by name were filed as ambulance services and lenders as medical suppliers; and the brand index's "sports shop" let golf and shoe chains back in as outdoor shops. Those kinds are now checked by name as well.
- **The backup is spelled out.** The places still come the old way when the ready-made set does not: on its own when the set cannot be reached, is over 60 days old or does not cover the regions chosen, and by choice under *Other ways* (build from regional extracts, or in small pieces from the shared servers). When a fetch of the set fails part way, what is on the computer is left untouched and the message says where the other way is.
- **The weekly job keeps itself running.** GitHub stops the schedules of a public repository that has had no activity for 60 days. After each build the job now commits a short record of it to `docs/PLACES-STATUS.md` (when it was built, how many places of each kind), which is a record worth having and is the activity GitHub asks for.

## 0.30.0 (2026-11-20)

The places are built once for everyone, and know their size.

- **A ready-made set of places.** The 13 GB of downloads and the sorting are the same work for every user, so a job on GitHub now does them once a week with the app's own code (`scripts/build-central-places.js`, `.github/workflows/places.yml`) and publishes the result beside the releases, as the files of the release *places-data*. The app fetches that set in place of the extracts: tens of megabytes, a few dozen files, each checked against a list of SHA-256 sums. It holds OpenStreetMap's places, Overture's places already sorted (so the separate fetch of added places is not needed for them), and the hospital list. The places of the regions chosen are kept. If the set cannot be reached, is over 60 days old or does not cover the regions, the app builds the places itself as before, and that way stays on offer under *Other ways*.
- **The extract server moved its files, and the app follows.** On 20 November 2026 the server that the places are built from put each regional file in a folder of its own; the old addresses answer "not found", so every version before this one can no longer build the places itself. The list packed with the app has the new addresses, and from now on the app reads the server's own index of where its files are before it asks for them, so the next move does not break it.
- **Better rules reach everyone without a new version.** The set is rebuilt from the sources by the rules in the repository, so a correction pushed there is in every user's places at their next update. Nothing is collected from users' computers: the build learns from the repository, not from anyone's use of the app.
- **Sizes.** A place drawn in OpenStreetMap as an outline now carries the ground it covers (worked out from the corners already read, at no cost in time). Ask understands **large** and **small**: "the nearest large hospital", "small airfields near home", "the biggest military base within 100 miles". Large is the largest third of a kind and small the smallest third; the answer says what that came to, and lists each place's size. A place drawn as a point has no size and is left out of such answers, which the answer also says. Sizes come with the ready-made set, or with a new build from extracts; places fetched before have none.
- **Military sites.** Asking for an army base listed recruiting offices and school cadet units, which OpenStreetMap maps as military land. They are no longer listed, from either source. Reserve and National Guard halls, and military lots under five acres, are kept as a lesser sort, so the nearest full bases are always in the list. An Overture "military" place must now say what it is in its name: the kind is full of nicknames.

## 0.29.0 (2026-11-19)

Places are sorted when they are fetched, from three public sources.

0.28.3 sorted Overture's places by the words in their names, because that was all the fetched records held. This version sorts them as they arrive, when more is to hand, and asks the name last.

- **The app's list of Overture's kinds was wrong, and is now Overture's own.** Of the 120 kind names the app asked for, 71 are not in Overture's published taxonomy of 2,302 kinds. That is why ambulance stations, medical supply shops and power plants received nothing and gun shops twelve, and the fallback to wider kinds is why golf, bicycle and clothes shops arrived as outdoor shops, airport terminals as airfields and recruiting offices as military sites. The list now names real kinds exactly; a kind under a listed one is taken only where the list says so. A test checks every listed name against the taxonomy.
- **Brands.** The Name Suggestion Index, OpenStreetMap's public list of brands and what each is, settles the branches of chains: on a real download, 30% of places. Aldi goes to the supermarkets, CAT Scale is left out of the fuel, Sherwin-Williams is marked as a paint shop. A cut of the index is packed with the app (`assets/maps/brands.json`, made by `scripts/make-brands.js`); a fresh one is fetched with the places from `cdn.jsdelivr.net`. Where Overture gives a brand's Wikidata id, that is used before the name. The index is deliberately not trusted too far: it never moves a pharmacy counter or a set of pumps to the shop around them, never moves a place in with the fuel on a shared name alone, and is not asked about fire or police stations.
- **Medicare's list of hospitals** (5,435 of them, public domain, from `data.cms.gov`) is fetched when a United States region is chosen and laid over the places when they are read: matched by telephone, or by postcode or town and name, never to a department or office of the hospital. A match makes the place a hospital whatever its name says, and gives it the list's word on its emergency room. In a state where at least 70% of the list is matched, a place Overture calls a hospital that is not on the list is marked as a lesser sort. Tried on 51 real rows against a real download: 48 found, and hospitals named like "Riverside Health Northside", which the name rule had sent to the clinics, came back.
- **New from Overture:** emergency departments (listed with the hospitals, emergency room: yes), ambulance and EMS services, medical supply shops, gun shops and warehouse clubs, by their exact kinds. Psychiatric, rehabilitation and long-term care hospitals are kept as a lesser sort of hospital.
- **Each fetched place keeps Overture's own kind**, and the fetch records how many places were settled by brand, by kind and by name (in the log and in `overture.json`).
- **To get all this, fetch the addresses and added places again** (Map, *Change or update*). It takes minutes. The Setup page says so where the places on the computer were fetched before. Until then, places already fetched are sorted when read, by brand and name; the hospital list is fetched only with a new fetch. The large OpenStreetMap places download is not affected and need not be repeated.
- Not done: Canada's and Mexico's official hospital lists; fire, police and ambulance have no maintained official list since the federal HIFLD portal closed in 2025.

## 0.28.3 (2026-11-19)

Every kind of place checked against the other source.

After the hospitals, all 22 kinds that Overture Maps supplies were compared with OpenStreetMap's hand-marked places on a real download (the United States, Canada and Mexico: 990,000 Overture places). Overture's listings are filed under wide kinds, and about one place in five was under the wrong one. Each is now put where it belongs when the places are read; nothing is fetched again. The full findings are in `docs/PLACES-AUDIT.md`.

- **Moved to the right kind (42,000).** Doctors' offices from *Hospitals* to *Clinics and urgent care* (36,000). Aldi, Save A Lot and other grocers from *Department and general stores* to *Supermarkets and grocery* (4,000). Gun shops from *Outdoor and sporting goods* to *Gun and hunting shops* (1,300; Overture's own gun-shop kind had supplied twelve). Supermarket fuel pumps and fleet fuel depots to *Fuel stations*. Medical equipment shops from *Pharmacies* to *Medical supply shops*. Police and fire stations filed under each other.
- **Left out (116,000).** Builders, roofers and other trades under *Hardware and building supply* (67,000 of 135,000). Shoe, team, golf, pool and clothes shops under *Outdoor and sporting goods* (39,000 of 70,000). Restaurants and collection desks under *Supermarkets and grocery*. Truck scales under *Fuel stations*. Airport gates, terminals and airline desks under *Airports and airfields*. Recruiting offices and veterans' clubs under *Military sites*. Mobile home parks and day camps under *Campsites*. Pet groomers under *Veterinary clinics*. Bank counters under *Department and general stores*.
- **Kept, but marked as a lesser sort (56,000).** Cages of exchange cylinders outside shops are 44,000 of the 47,500 *Bottled gas and propane* places; visiting vaccination clinics are under *Veterinary clinics*; bicycle shops are under *Outdoor and sporting goods*. Each is named for what it is in lists and on its card. In Ask, when they would fill a list of the nearest, the three nearest of the full sort are listed with them and a note says so.
- **OpenStreetMap is taken as it is**, with one exception: shoe, team and golf shops among its sports shops are not listed as outdoor shops.
- **From the next fetch of the Overture places, each keeps Overture's own kind**, so a later check can sort by kind where the name says nothing.
- The rules go by the words in a place's name (English, French and Spanish), which is all there is to go by in what was fetched. Some places will be sorted wrongly; the kinds with the most left over are *Supermarkets and grocery* and *Department and general stores*.

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
