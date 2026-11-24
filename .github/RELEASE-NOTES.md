The installer is **Wikivault-Setup-0.41.0.exe**, under *Assets* below. Download it and run it: [step by step](https://github.com/wwmotorsport/WikiVault/blob/main/DOWNLOAD-INSTALLER.md). It installs over an earlier version and keeps the library and settings.

Wikivault keeps Wikipedia, a map of the country and the means to use them on one Windows computer, so that they still work with no connection.

**In this version**

- **Wikipedia offline**, with search, a reader, and answers written by a model that runs on the computer and cites the articles it read.
- **An offline map** with street addresses, places worth knowing in an emergency (hospitals, fuel, water, supplies and more), and turn-by-turn directions that can go around roads or areas you mark as blocked.
- **Live navigation** with a USB GPS receiver: where you are, the next turn spoken in good time, your speed, the distance left and the time of arrival.
- **An address book** for the people and places that matter, which can copy your Google or iCloud contacts.
- **One page, Options and Setup,** to choose what to download, see how much room it takes, and fetch it all with one button.
- **Survival Guides:** practical guides on water, first aid, medicine, food, knots and disasters, converted on the computer into searchable articles with their pictures, and room for books of your own.
- **More libraries** to add: Wikibooks, Wikiversity, Appropedia, a medical encyclopedia, question-and-answer sites, repair guides and more.
- **A guide for every page**, from the **?** button at the top.
- Wiki golf, for when the work is done.

**New since 0.39.0**

- **Ask reads every library at once.** A question is put to all the libraries that can be read, whichever is open. Each source says which library it came from, and one library can be asked alone.
- **A newer version is announced.** The app looks at this page now and then and, when a newer version is published, says so with a link to its installer. It can be switched off under *Options and Setup*.
- **The map zooms by itself while a route is followed,** to keep the next turn in view. Zoom it yourself and it stays where you put it; *Resume auto-zoom* takes it up again.
- **Turns are spoken in time for the speed:** a quarter of a mile ahead in town, a mile ahead at 60 miles an hour and above, with a reminder in between and a last word at the turn. Straight after a turn, when the next is more than a mile off, the voice says what it is and how far.
- **An arrow shows the way you are heading** when the map is turned to the way of travel, and the directions button says *Start guidance* when the GPS is giving a position.
- **Fixed:** "No way through was found" when a trip started from a car park or a private drive. The trip is now tried again with that end moved a little.

**Earlier, since 0.34.1**

- **Setup in one pass.** Every download shows its size at once, as an estimate, and the totals and the disk bar follow each tick. Measure the true sizes when you want them, or download straight away. The page no longer jumps while sizes are worked out.
- **Survival Guides.** Collections of PDF guides are fetched and converted into articles: text as text, every picture and diagram in its place, scanned pages read for their words, the original PDF one click away. Your own PDFs, or a folder of page photographs, can be added the same way.
- **More libraries,** each optional, and all of them in the one downloads list.
- **Ask looks further.** When the open library has nothing on a question, Ask asks the library that does and says so. Every answer lists the other libraries with matches, and names the ones it cannot read.
- **Live navigation:** the mark glides instead of jumping, the map can turn with the way you travel, a trip can be ended without disconnecting the GPS, and trips can be recorded and found again by date and town (off until you switch it on; kept on the computer only).
- **External drives.** A drive chosen for the library is timed and reported on, with advice if it is too slow. If the library's drive is not plugged in when the app starts, the app says so and opens the library when it is back.
- **Contacts:** a plain list (Name, Address) is read, and an address that landed in a contact's note is used.
- **Fixed:** installing the answer model failed with "Not found (404)" when Microsoft's newest installer was missing; it now falls back to the version before.

**School is in development.** A school section, a full year of lessons laid out week by week, is being built and is not in this version. It is switched off here while it is finished and will arrive in a later release.

**Good to know**

- Windows may say "Windows protected your PC", because the installer is not code-signed. The step-by-step guide says what to press.
- The first downloads are large (Wikipedia alone is tens of gigabytes) and take hours. They can be stopped and carried on.
- After installing over a version older than 0.30, open *Options and Setup* and press the download button once, to get the ready-made places with their sorting and sizes. It takes a minute or two.
- Converting a collection of Survival Guides takes minutes for the small ones and much longer for the largest. It can be left to run.
- Ask cannot read inside two of the optional libraries, which are collections of PDF files (Army publications and the Survivor Library). It names them when it leaves them out; they can be browsed and searched by title.
- A GPS receiver needs no firmware. Windows has to have set it up as a serial (COM) port, which most do by themselves.
- Looking addresses up online covers the United States and Puerto Rico, and places a house along its street, usually within a few doors.
- Not every address is in the open address data. When one is not, the app places it by its street or its town and says so.

What changed, version by version, is in [CHANGELOG.md](https://github.com/wwmotorsport/WikiVault/blob/main/CHANGELOG.md). How to use everything is in the [user guide](https://github.com/wwmotorsport/WikiVault/blob/main/docs/USER-GUIDE.md).
