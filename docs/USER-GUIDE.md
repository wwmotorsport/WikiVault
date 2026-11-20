# Wikivault user guide

How to install the app, set it up and use it. For what it is, see the [README](../README.md); for what changed in each version, the [changelog](../CHANGELOG.md).

## Installing, step by step

Everything from finding the installer to reading your first article. Allow ten minutes for the steps, then however long the download of Wikipedia takes.

**Before you start** you need a Windows 10 or 11 computer (64-bit), an internet connection for the setup, and free disk space: well over 100 GB for the full Wikipedia with images, roughly a quarter of that without images, and a few GB for introductions only. The setup screen shows the real size of each and whether your drive has room.

### 1. Get the installer

<!-- download:start -->
The direct link is **[Wikivault-Setup-0.30.1.exe](https://github.com/wwmotorsport/WikiVault/releases/download/v0.30.1/Wikivault-Setup-0.30.1.exe)** (Version 0.30.1, 139 MB).
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

## Setup and downloads

**Setup**, in the top bar, is one page for everything the app can fetch or set up: Wikipedia, the offline answers, the map, directions, addresses, places, the other libraries, a GPS receiver and the address book. The number on the button is how many ticked things are still to do.

Each row says where it stands:

- **Done**: in place and up to date. It is left alone.
- **To do** or **Update**: ticked, and not there yet, or there is something newer.
- **Working**, **Failed** (with the reason), or **Not chosen**.
- **New** marks what has been added since the version you last had.

Tick what you want. For the map, tick the areas and choose how much detail to keep.

**Sizes.** Two columns run down the right of the rows. *Still to download* is what each row will fetch as it is ticked now; it changes as you tick, untick, add a region or choose less detail. *Downloaded* is what that row already has on the disk. A row that is not ticked shows its size in italics, "if ticked". Under the list, **In all** adds up each column. Sizes that have to be asked for (the map, the directions, the addresses and places, the other libraries) are worked out by the page itself when it is opened and when the choice changes; this reads only summaries, takes a minute or two, and needs a connection. **Work out the sizes** asks again if that failed.

**Room on the disk.** A bar shows the whole of the drive the library is on: grey for everything else on it, blue for what Wikivault has downloaded, striped amber for what the ticked rows will add, and white for what stays free. The sizes are written under it. When the library has a partition of its own, that partition is the first bar and the drive it was cut from is a second one below. If what is ticked will not fit, the part to be added turns red, the page says by how much, and **Download everything ticked** asks first: change what is ticked, make the partition larger, add storage, or download anyway.

**Download everything ticked** fetches the rows one after another: map, directions, places, addresses, the slow places last, and the other libraries once Wikipedia is there. The offline answers set themselves up alongside, and are then tuned to this computer by timing the models that suit it.

**While it downloads**, the row at work shows a progress bar, a line saying what is being fetched and how far it has got, the speed, and about how long is left, so there is no need to go to the page it belongs to. Speeds are in megabytes a second. A step that is not a download, such as sorting the addresses or checking a file, has a bar and no speed. You can leave the page and use the app meanwhile. If the app is closed part-way, it carries on when it is opened again. One thing failing does not stop the rest.

The page opens by itself the first time the app is run, and once after each update, with what is new at the top. **I'll do this later** closes it. On a new installation the first row, *Where the library lives, and Wikipedia*, leads to the first-run page described next; the other rows can be fetched as soon as the library has a home, while Wikipedia is still downloading.

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
- Only the system drive is offered. It can be done before the first download, as described here, or at any time afterwards from the Library page (see *Managing the partition later*).
- It can be undone from inside the app; see the next section.

### Managing the partition later

The **Partition** section of the Library page shows how full the partition is: how much is in use, how much is free, and how much of that the library itself takes. The bar turns amber when less than a twelfth is free. A map, addresses, routing data and school files all live on the partition, so it fills as you add them.

**Change the size** opens a box with the smallest, largest and recommended sizes and a field for the size you want. The same box opens from **Give the library its own partition** when the library is in an ordinary folder.

Windows can only grow a partition into free space that comes after it on the disk. The library's partition sits directly after `C:`, so it cannot be stretched into space taken from `C:`, and `C:` cannot be stretched over space given up by the partition. Changing the size therefore means making the partition again:

1. The library is copied to a folder on `C:` and checked. The app switches to that copy.
2. The partition is removed and its space returned to `C:`. Windows asks for administrator approval.
3. A new partition of the chosen size is made. Windows asks a second time.
4. The library is copied onto it and checked, and the copy in the folder is removed.

This needs enough free space on `C:` to hold the whole library for a while, and the box says how much there is and how much is needed. The library is copied twice, so allow time for it. The library stays usable throughout.

If a step fails, nothing is lost: the library is whole wherever the last finished step put it, and the message says where. If Windows can free less than it reported beforehand, the app makes the partition as large as Windows allows, provided that still holds the library, and says so.

If the library ends up in a folder with an empty partition beside it, the Library page offers **Move the library onto drive W:** and **Remove drive W:**.

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

## Map

The folded-map button in the top bar opens an offline map. The tools are on the left and the map is on the right. It has the map, the places on it, and directions. Address search and sending maps to a phone are not in yet.

**Setting it up.** Press *Set up the map*.

1. Under *Cover*, tick the regions you want. The contiguous United States is ticked to start with.
2. Press *Measure the sizes*. The map is cut from a world map of about 140 GB that is rebuilt every day from OpenStreetMap. Measuring reads that file's index, which is tens of megabytes, and lists what each level of detail would take for the regions you ticked. Nothing large is downloaded.
3. Under *Detail*, pick a level. *Highways and cities* is enough to cross the country. *Every street* has every street with its name, and tracks and trails. *Everything* adds building outlines. The size beside each is what it will take on disk.
4. Press *Download this map*. Only the parts of the world map you chose are fetched. It can be stopped and carried on later.

To change the regions or the detail, or to get a newer map, press *Change or update* and do the same again. The map you have stays in use until the new one is complete.

**Key and layers.** A key in the corner of the map says what each line and colour stands for, and it is also where you choose what the map shows. Interstates and freeways and main roads are always drawn. Every other kind has a tick box beside its picture: woodland, parks and land use; water; buildings; streets, tracks and paths; railways; borders; road names and numbers; names of towns and places; and the small symbols for shops and sights. Untick one to take it off the map; it stays in the key, greyed, so it can be ticked again. *Dark map*, at the foot of the list, turns the map dark for a dark room or a night drive. Your choices are kept. Below the switches the key names the app's own marks while they are on the map: your route with its start and destination, pinned and saved places, places found, blocked areas, and where you are.

*Hide* folds the key down to a button, **Key and layers**, which opens it again. The key also folds by itself while the map is waiting for you to click a spot. The first times the pointer comes near the key, a note says what it is for. *Got it* puts the note away until the app is next started; *Don't show this again* puts it away for good.

**Road numbers** are drawn as the signs beside the road: a red, white and blue shield for an Interstate, a white shield for a US highway, and a plain white sign for state and other numbered roads. The map data marks Interstates as such; a US highway is told by how its number is written, so a few may show the plain sign.

On the map, highways are orange, main roads amber, streets white, and tracks and paths brown and dashed. Roads are drawn heavier as you zoom in.

Buildings, like everything on the map, are what OpenStreetMap's volunteers have drawn. A house built in the last few years is often not there yet. That does not affect directions, which follow roads.

**Places.** In the same panel, *Fetch the places* asks OpenStreetMap for the places in the ticked regions: hospitals, clinics and pharmacies; fire, police and ambulance stations; water and wastewater works, water towers, drinking water, springs and wells; power plants and substations; fuel; supermarkets, wholesale clubs and food banks; department, hardware, farm supply, outdoor and gun shops; airfields, rest areas, campsites and ranger stations; military sites, town halls and courthouses; and cities, towns and villages. Places can be fetched with or without the map.

The places are read out of **regional OpenStreetMap extracts**: files published every day by Geofabrik, one to a state or province, that hold everything OpenStreetMap has there. For each file the app downloads it, reads the places out of it on this computer, and deletes it.

- **It is a large download for what is kept.** The contiguous United States is 49 files and about 11 GB, of which a few hundred megabytes at most stay on the disk. In exchange it is quick and dependable: a download server sends a whole file gladly. *Measure the download* asks the server for the sizes first, and downloads nothing.
- **Room while it works.** One file is held at a time, so the room needed is the size of the largest (a little over a gigabyte for the largest states), not the whole download.
- **Nearest first.** The files nearest you come first: around your GPS position if a receiver is connected, otherwise around the place you pinned as *Home*. What has been read can be searched straight away, and the map page says how many places are in so far. (When a complete set is already in use and you are updating it, the old set stays until the new one is whole.)
- **Stopping and carrying on.** What has been read is kept, and so is the part of a file that had arrived. If the run fails, or you stop it or close the app, fetch the places again and it carries on from there. The Setup page asks again by itself a few times.
- **Checked.** Each file is compared with the checksum the server publishes beside it, where there is one, and a file that does not match is not read: it is fetched again at once. The server replaces its files once a day, so the app asks where each file is just before fetching it.
- **Updating.** Once the places are complete, *Update the places* downloads every file again; it does not carry on from anything. If they were fetched in the last two weeks the app says so and waits for a second press. Once a month is plenty.

**Another way, with very little to download.** Under the button, *Another way* asks for the same places in small pieces from free, shared servers (the Overpass service). Almost nothing is downloaded beyond what is kept, but those servers are slow and often busy, and their rules allow a program one question at a time: the whole country can take many hours. Use it when the connection or the room on the disk does not allow the large download. It, too, fetches the nearest pieces first, keeps what arrives, and carries on where it stopped.

The places from Overture Maps (below) arrive in minutes and cover shops, fuel, hospitals and other businesses; the OpenStreetMap places add what Overture does not have, such as towns, water works, springs and power plants.

**Finding a place.** Type a name, a street or a town and press *Find*. The best match opens on the map. Or choose a *Kind of place* and leave the box empty: the map then shows the places of that kind in view, and the list has them nearest the middle of the map first, with the distance. Move the map and the list follows.

Click a place for what is recorded about it: address, telephone, hours, who runs it, its position, and details that matter for its kind, such as whether a hospital has an emergency room or a fuel station sells diesel.

**Addresses and more places.** Under *Change or update*, the *Addresses and more places* box fetches two things from Overture Maps for the ticked regions: street addresses, and places OpenStreetMap does not have. Press *Measure the addresses and places* first. It reads only the summaries of Overture's files and tells you how much there is to download and how much room the address index needs. Untick either line to leave it out, then press *Download*. The download is quick; reading and sorting a hundred million addresses takes longer, and the bar says which part it is on. You can keep using the map meanwhile. If you stop it or close the app, it carries on from the files it had finished.

Once the addresses are there, type one in the Places box or as the start or destination of a route: `350 5th Ave, New York, NY`. The town, state or ZIP code can be left off, in which case the nearest street of that name to the middle of the map comes first.

- An address that is in the data is shown as it is.
- A number that is not in the data is placed between the nearest known numbers on the same street, and marked *Approximate position*. The note says which numbers it lies between.
- If only the town or the ZIP code can be found, you get the middle of it, marked *Approximate: the town only*.

**Directions to an approximate place say so.** Above the turns, an amber note says the start or the destination is approximate and why. When all that could be found is the town or the ZIP code, the note is red and says plainly that the directions do not end at the address. The end of such a route has an orange ring on the map, and the key names it. Ask says the same when it works out a route, and with a GPS receiver the app does not say "You have arrived" at an approximate place: it says you have reached the approximate position, or the middle of the town, and that the address itself was not found.
- A row of the data that names no town, or names the suburb where you wrote the city, is still found when it lies near the town or ZIP code you gave. When the data has it under another town's name, the note says so.
- Directions to an approximate address carry the same warning above the steps. They will take you to the right street and close to the house, not to the door.

Places that come from Overture say so when opened. They are sorted into the map's kinds by their names (see *The nearest place of a kind*), added only where OpenStreetMap has no place of a like name close by, and they are checked less, so one may have moved or closed.

**GPS.** Plug a USB GPS receiver into the computer, open *Directions*, and press *Find my GPS receiver*. The app tries each serial port at the usual speeds until one sends positions, so there is nothing to set. Outdoors or by a window the first position takes a minute or two. Then:

- a blue dot shows where you are, and *Keep the map on my position* follows it;
- *Start from my position* makes the position the start of a route;
- with a route on the map, a banner at the top says the next turn and how far it is, and how far there is still to go;
- if you leave the route, a new one is worked out from where you are;
- *Speak the turns* reads each turn aloud as it comes up, using the voices Windows has.

The receiver is only read, never written to. A receiver that shows up in Windows as a COM port and sends standard NMEA sentences works; most USB "puck" receivers do. Some need the maker's driver before Windows shows the port. *No receiver yet?* under the button and on the Setup page opens the shop page of one such receiver, the GlobalSat BU-353N5, in your web browser. Any receiver of the kind described above should do.

**Saved: the address book.** The *Saved* tab keeps people and places: a name, an address, telephone numbers and notes. An entry's address is looked up in the app's own address data to place it on the map, with the same *Approximate* marking as any address; one that cannot be found can be placed by clicking the map.

**Why an address may not be on the map.** The address data is free and public, and it is not complete. In the United States it holds about 126 million addresses, gathered from the federal National Address Database and from counties and cities that publish their own. States and counties that publish nothing are missing, some of them large, and many rows that are there carry no town or no ZIP code. The app does what it can with that: it reads a contact's address past a company name or an apartment line, finds a row that names no town by where it lies, and when the street is not in the data at all it places the entry at the middle of its ZIP code or town and marks it approximate. An entry that still has no place says why when you point at *Not on the map yet* or open it. The list can be narrowed to *Address not on the map yet* and to *Placed approximately*, to go through them. The towns and ZIP codes are worked out from the address data itself, once, the first time the app starts with new address data (about a minute for a whole country); entries are tried again when that is done, when new places or addresses arrive, and with each new version of the app. Saved entries are found by name in the Places box and as the start or end of a route, ahead of everything else, and any place on the map can be saved from its pop-up.

**Pins.** Open an entry with its *Edit* button and choose *Pin this place as*: Home, Work, School, Meeting point or Other, with a name of your own if you like ("Lake cabin"). Pinned places are listed in their own group above everything else, by kind, and are drawn larger on the map. Several places can share a kind.

**Relationships.** In the same form, *Relationship* sets a group (Family, Friends, Work, Neighbors, Doctors and care, Other) and *Who they are to you* the tie itself: mother, wife, father-in-law, or any wording of your own. A known tie fills in its group. The relationship belongs to the person, so a contact with a home and a work address carries it on both.

Pins and relationships are your own marks. They are kept in this app only and are never sent to a contacts account. Setting them on a contact that came from Google or iCloud leaves it in step with the account, and they stay when the account is read again, also when the address has changed there. Changing the name, address, telephone or notes is different: that makes the entry yours, and reading the account again then leaves it alone.

**Narrowing the list.** Under the filter box are two lists. The first shows everything, only entries with an address, only those with a place on the map, or only those with no address (a telephone number alone). The second shows one relationship group, or those with none set. The filter box also matches relationships, so typing *mother* or *family* works. The choices are remembered. The pinned group stays in view whatever is chosen.

**Directions to here, directions from here.** Every saved entry with a place on the map has these two buttons under it, and so does the card of any place, address or saved entry on the map. Clicking a bare spot of the map opens a small card for that spot with the same buttons (and *Save to the address book*); a click while a card is open only closes it. Either button sets that end of the trip and asks for the other: choose it from the list, where your pins come first and the GPS position is offered when there is one, type a name, an address or a place and press *Get directions*, or press *Pick the spot on the map* and click. The route is then drawn without another press.

Everyday words are understood wherever a relationship is searched for, in the Places box and in Ask: *mom*, *mum* and *mother* are the same tie, as are *grandma* and *grandmother*, and *mother in laws* is read as *mother-in-law*.

*Contacts accounts* keeps a copy of your contacts on this computer and reads them again by itself, once a day unless you choose otherwise, so the addresses are there when the network is not. It only reads; nothing in your account is changed.

- **Google**, the simple way: your Google address and an *app password*, made at myaccount.google.com/apppasswords once 2-Step Verification is on. It can be withdrawn there at any time. Google's own documentation says its contacts server wants the full sign-in, and yet it has gone on accepting app passwords; if yours is refused, use the other way.
- **Google**, the other way: sign in on Google's own page in your browser, through a "client" that you register with Google once, free. The dialog lists the steps. While the client's status is *Testing*, Google ends the sign-in every seven days and you sign in again; the contacts already copied stay. Publishing it to *In production* removes the limit, but Google asks for a home page and a privacy policy page first.
- **Apple iCloud** needs your Apple Account's e-mail address and an *app-specific password*, made at account.apple.com. Your usual password does not work here, and the app-specific one can be withdrawn at any time.
- **A file**: a vCard (.vcf) file from any contacts program, or a CSV file from Google Contacts or Outlook.

The sign-ins are kept encrypted by Windows for your user account, in the app's own data folder, and go only to Google or Apple. A contact with two addresses becomes two entries. An entry you change is yours from then on, and reading the account again leaves it alone.

**Directions.** Directions need routing data, which is separate from the map. Under *Change or update*, in the *Directions* box, press *Measure the routing data*; the app asks the server how big the files are for the regions ticked, then offers the download with its size. The engine that reads them (BRouter) and the Java it needs come with Wikivault.

Then open the *Directions* tab.

1. *From* and *To*: type a place or a town, or coordinates such as `35.22, -80.84`, or press *Pick on map* and click the spot. A place's details also have *Directions from here* and *Directions to here*. Street addresses cannot be typed yet.
2. *Travelling by*: car; car with farm and forest tracks allowed, for a vehicle that can take them; bicycle; bicycle off road; on foot. For a car you can also keep off motorways.
3. Press *Get directions*. The route is drawn on the map, with its length, an estimate of the time on open roads, and the steps. Click a step to see that turn on the map.

*Another route* gives up to three alternatives.

**When a road or an area is closed.** Under *Blocked roads and areas*, choose how far around the spot is closed, from 200 yards (one junction or bridge) to 100 miles (a whole region), press *Mark on map*, and click where it is. The route is worked out again at once, clear of every block you have marked. Blocks stay until you remove them. If no way is left, the app says so; try the car setting that allows tracks, or go on foot, which may use paths a car cannot.

The names in the steps come from the map, because the routing data has none. With the map at *Every street* or more, turns are named. With less detail some steps read only "Turn left", and the route says the names are missing.

The engine works out routes from the roads as they were mapped, with no knowledge of traffic, closures or damage; that is what the blocks are for. Check a route against what you can see.

**What to keep in mind.** The places are what volunteers have mapped. Hospitals, fuel and shops in towns are well covered; the countryside is thinner, and a place can have closed since it was mapped. A shop being on the map says nothing about what it has in stock. Treat water from any spring or well before drinking it. There is no layer for public and private land yet.

**Where it is kept.** `<library>\maps\map.pmtiles` is the map, `maps\places\` the places, and `maps\routing\` the routing data. They move with Wikipedia when the library is moved, count toward the size of a dedicated partition, and are removed by the uninstaller if you ask it to remove your data.

**Credit.** Map data and places are © OpenStreetMap contributors, under the Open Database License. The map file is cut from the Protomaps basemap. Wikivault is not affiliated with either.

## School (in development)

A school section, a full year of Grade 5 lessons laid out week by week, is being built and is **not in this version**. It is switched off in the released app while it is finished, and will come back in a later version. Nothing of it is downloaded or shown meanwhile. If an earlier version of Wikivault downloaded school files on your computer, they are left where they are, in `<library>\school\`, and move with the library.

What it does so far is described in [SCHOOL.md](SCHOOL.md).

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

## The tour, and a guide for every page

A short tour opens over the main window: numbered pins on the buttons along the top, and a card that says what each one does. **Got it** closes it; it opens again at the next start. **Don't show again** stops that. The first time a new version runs it opens once more, with a short list of what is new.

The tour goes on from there. **Walk me through the next page** opens the next page of the app and points at its parts in the same way: Setup, Ask, Map, Wiki golf and Library, in that order, with a button to go back. On these pages the card sits in the corner, and pointing at one of its lines lights the part it is about and brings it into view when the page is longer than the window.

The **?** button at the end of the top bar opens the guide for whichever page you are on, at any time. **Library > About > Show the tour** starts it from the beginning, and the tick box beside it switches the automatic opening back on.

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
- asks whether to also remove the library and settings. If you say yes it deletes the app's own files only: editions, partial downloads and the state file in the library folder, the map and its places, the school books with their index and your progress, the staging folder's files, and `%APPDATA%\Wikivault` (settings, log, reader engine, caches). Anything else you put in the library folder is left alone;
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

### Asking for directions and saved places

Ask also understands requests that are for the map, and carries them out there instead of searching the articles:

- "Please give me directions from my house to my mother-in-law's house"
- "Take me to work", "Walk me to the meeting point", "Route from 350 5th Ave, New York NY to Brooklyn by bike"
- "Where does my brother live?", "Show me Dave Park on the map", "What is my wife's work address?"

Each place named is looked for in this order: your pins ("my house", "home", "work", "the office", "school", "the meeting point", or a pin's own name), your relationships ("my mother-in-law", "mom's house", "my wife's work"), the names of saved people and places, and then the map's addresses, places and towns. "Here" and "my location" mean the GPS position. When no start is given the route starts at the GPS position, or at the place pinned as Home when there is no receiver.

The map then opens on the Directions tab with both ends filled in and the route drawn, as if you had typed them there; blocked areas already marked are kept clear of. The Ask panel says how it read the request ("Understood as: ...") and gives the distance and time. When a place cannot be found it says which one and why, for instance that a contact has no address or that nobody is marked as your sister yet.

### Asking for the nearest places of a kind

Ask also finds the places of a kind near somewhere, from the places fetched for the map:

- "What is the nearest hospital to home?", "Which pharmacy is closest to my mother-in-law's house?", "Where is the closest emergency room to 350 5th Ave, New York NY?"
- "Nearest gas station", "Hospitals near me", "Is there anywhere to get propane around here?" With no place named, distances are measured from your GPS position if a receiver is connected, otherwise from the place pinned as Home, and the answer says which.
- "List the hospitals within a 10 mile radius of home", "Pharmacies within 15 km of work", "How many fire stations are within twenty miles of work?"
- "The five closest supermarkets to home", "Hospitals in Concord", "How far is the nearest hospital?"
- "Where is the nearest hospital to there?" after another request: *there* is the place the last request was about (the place shown, the destination, or the nearest one found).
- "Directions to the nearest hospital", "Take me to the closest gas station": the nearest one is used as the destination.

The kinds are the ones in the map's *Kind of place* list, under the words people use for them: hospital, emergency room or ER; clinic, urgent care or doctor; pharmacy or drug store; vet; fire station; police or sheriff; water, drinking water, spring or well; water tower; water treatment; power plant; substation; gas, fuel or gas station; propane; grocery, supermarket or food; food bank; hardware or building supply; farm supply or feed store; sporting goods; gun shop or ammunition; airport; rest area; campground; ranger station; military base; town hall or courthouse; towns. A shop asked for by its name ("the nearest Walmart to home") is looked for by name within fifty miles.

The answer lists them nearest first, each with its distance and direction in a straight line, its address and telephone where known, and whether a hospital has an emergency room. The same places are put on the map's *Places* tab and drawn on the map. Each row has *Show on the map* and *Directions*. For the first three, the distance and time by road are worked out too, and if the nearest by road is not the nearest in a straight line, the answer says so.

**Where the places come from.** Building them takes about 13 GB of downloads and an hour of sorting, and comes out the same for everyone. So it is done once a week on GitHub, by the app's own code, and the app fetches the result: a few dozen small files (tens of megabytes), each checked against a published list. They hold OpenStreetMap's places, Overture's added places already sorted, and the hospital list, for the United States, Canada and Mexico; the places in your regions are kept. **The backup.** GitHub is not the only way to the places. When the set cannot be reached, is more than 60 days old, or does not cover your regions, the app builds the places on your computer from the same sources it always used (regional OpenStreetMap extracts, about 13 GB to download, of which little is kept), without being asked. You can choose that yourself under *Other ways*, where the slow way in small pieces from shared servers is offered too, and the added places from Overture can still be fetched on their own. If a fetch of the set fails part way, the places already on the computer are left as they are. What was last built is recorded in [docs/PLACES-STATUS.md](PLACES-STATUS.md). Either way nothing about you is sent: the set is the same for every user.

**Large and small.** Where OpenStreetMap draws a place as an outline, the app knows the ground it covers, and Ask understands "the nearest large hospital", "small airfields near home" or "the biggest military base within 100 miles". Large means the largest third of that kind of place, small the smallest third; the answer says what size that came to. Places drawn as a single point, and all of Overture's, have no size and are left out of such an answer, which it tells you.

The two sources do not sort places alike. OpenStreetMap's are marked by hand, one kind at a time. Overture's come from business listings, which file a doctor's office under "hospital", a roofer under "building supplies" and Aldi under "discount store". So each Overture place is put under the right kind as it is fetched, by three things, strongest first:

1. **Its brand.** A public list of brands (the Name Suggestion Index, kept by OpenStreetMap's contributors) says what each chain is: Aldi is a supermarket, CAT Scale is a truck scale. About a third of the places are branches of a chain. A fresh copy of the list is fetched with the places; a copy is packed with the app in case it cannot be.
2. **Overture's own kind for it**, exactly. A golf shop is filed under sporting goods but is not an outdoor shop, and is not taken; a gun shop is listed with the gun shops; an airport terminal is not an airfield.
3. **Its name**, where Overture's kind is one it uses loosely: a "hospital" named Lakeside Family Medicine goes with the clinics, a "building supplier" named Top Notch Roofing is left out.

A few places are kept and marked as a lesser sort of their kind, such as a cage of exchange cylinders outside a shop under *Bottled gas and propane*, a psychiatric hospital under *Hospitals*, or a bicycle shop under *Outdoor and sporting goods*. They are named for what they are, and when they would fill a list of the nearest, the three nearest of the full sort are listed with them.

**Hospitals in the United States** are also checked against Medicare's list of certified hospitals, fetched with the places. A place on the list is a hospital whatever it is called (many are named like "Riverside Health Northside"), and shows the list's word on whether it has an emergency room. A place Overture calls a hospital that is not on the list is kept but marked "Not on the Medicare hospital list". OpenStreetMap's hospitals, and hospitals in Canada and Mexico, are left as they are.

Places fetched before version 0.29 were not sorted as they arrived and do not carry Overture's kind; they are sorted by brand and name when read. Fetch the addresses and added places again (*Change or update* in the Map section; it takes minutes) to have them sorted in full. The large places download from OpenStreetMap is not needed again.

Two things to know. The list is only as good as the places on the computer: fetch both the OpenStreetMap places and the Overture places on the Setup page. And a question that is not about places ("what is the nearest star to the sun") is left to the articles.

This part does not use the model. It works by rule, at once, and before answers are set up. When the wording is loose ("I need to be driving over to see Rosa, what is the way to go?") and answers are on, the model is asked to pick out the places.

Wording that could be either kind of question, such as "Where is Jordan?" or "How far is it from the Earth to the Moon?", goes to the map only when a place it names is one of your own pins, relationships or contacts. To be sure of the map, say *directions*, *route*, *take me to* or *on the map*. A map answer always has a *Search the articles instead* button.

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
| The map and its places | `<library>\maps\` (`map.pmtiles`, `places\`) |
| School books, their text index and your progress (School is in development and not in this version) | `<library>\school\` (`g5\`, `index\`, `progress-g5.json`) |
| Wiki golf players and records | `%APPDATA%\Wikivault\golf.json` |
| The address book, and the sign-ins for contacts accounts (encrypted) | `%APPDATA%\Wikivault\addressbook.json`, `accounts.json` |

## If something goes wrong

- **Nothing downloads / "Could not reach the Kiwix download server"**: check the connection and press Try again. `wikivault.log` has details.
- **The reader engine could not be downloaded**: download `kiwix-tools_win-x86_64-*.zip` (or `win-i686`) from https://download.kiwix.org/release/kiwix-tools/ and unzip it into `%APPDATA%\Wikivault\engine\`. Or set `enginePath` in `settings.json` to the full path of `kiwix-serve.exe`.
- **"Foundry Local would not keep the model loaded"**: the app already tried loading the model twice. Run `foundry service restart` in a terminal and ask again. If it keeps happening, `foundry model load phi-4-mini` in a terminal shows Foundry Local's own error.
- **"Foundry Local was not found"** right after installing it by hand: press **Set up answers** again (the app re-reads the PATH), or restart Wikivault. `foundry --version` in a terminal confirms the install.
- **Answers are slow or cut off**: lower the reading budget, or pick a smaller model.
- **Full-text search finds nothing**: it needs every word to match. Use fewer words. (Ask loosens the query automatically.)
