The installer is **Wikivault-Setup-0.30.1.exe**, under *Assets* below. Download it and run it: [step by step](https://github.com/wwmotorsport/WikiVault/blob/main/DOWNLOAD-INSTALLER.md). It installs over an earlier version and keeps the library and settings.

Wikivault keeps Wikipedia, a map of the country and the means to use them on one Windows computer, so that they still work with no connection.

**In this version**

- **Wikipedia offline**, with search, a reader, and answers written by a model that runs on the computer and cites the articles it read.
- **An offline map** with street addresses, places worth knowing in an emergency (hospitals, fuel, water, supplies and more), and turn-by-turn directions that can go around roads or areas you mark as blocked.
- **A GPS receiver** on a USB port shows where you are and leads you along a route.
- **An address book** for the people and places that matter, which can copy your Google or iCloud contacts.
- **One Setup page** to choose what to download, see how much room it takes, and fetch it all with one button.
- **A guide for every page**, from the **?** button at the top.
- Wiki golf, for when the work is done.

**New since 0.26.1**

- **Places arrive ready-made.** The map's places (hospitals, fuel, shops, fire and police stations and the rest) used to take hours and about 13 GB of downloads to build. They are now built once a week on GitHub by the app's own code, and the app fetches the result: about 66 MB, checked file by file. If that set cannot be reached, the app builds the places on your computer as before, and you can choose that yourself.
- **Places are sorted properly.** Doctors' offices are no longer listed as hospitals, builders as hardware shops or recruiting offices as military bases. Chains are sorted by a public list of brands, hospitals in the United States are checked against Medicare's list (with whether each has an emergency room), and cylinder-exchange cages no longer crowd out propane suppliers.
- **Ask finds the nearest of a kind:** "what is the nearest hospital to home", "pharmacies within 10 miles of work", "the nearest large hospital", "the biggest military base within 100 miles".
- **The map:** the key holds the switches for what the map shows; dragging the map no longer opens a card; directions say when they end at an approximate position.
- **If you have an earlier version, update.** The server that the places are built from moved its files on 20 November 2026, and earlier versions can no longer fetch places at all.

**School is in development.** A school section, a full year of lessons laid out week by week, is being built and is not in this version. It is switched off here while it is finished and will arrive in a later release.

**Good to know**

- Windows may say "Windows protected your PC", because the installer is not code-signed. The step-by-step guide says what to press.
- The first downloads are large (Wikipedia alone is tens of gigabytes) and take hours. They can be stopped and carried on.
- After installing over an earlier version, press *Update the places* in the Map section once, to get the ready-made set with its sorting and sizes. It takes a minute or two.
- Not every address is in the open address data. When one is not, the app places it by its street or its town and says so.

What changed, version by version, is in [CHANGELOG.md](https://github.com/wwmotorsport/WikiVault/blob/main/CHANGELOG.md). How to use everything is in the [user guide](https://github.com/wwmotorsport/WikiVault/blob/main/docs/USER-GUIDE.md).
