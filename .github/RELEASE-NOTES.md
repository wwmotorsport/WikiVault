The installer is **Wikivault-Setup-0.34.1.exe**, under *Assets* below. Download it and run it: [step by step](https://github.com/wwmotorsport/WikiVault/blob/main/DOWNLOAD-INSTALLER.md). It installs over an earlier version and keeps the library and settings.

Wikivault keeps Wikipedia, a map of the country and the means to use them on one Windows computer, so that they still work with no connection.

**In this version**

- **Wikipedia offline**, with search, a reader, and answers written by a model that runs on the computer and cites the articles it read.
- **An offline map** with street addresses, places worth knowing in an emergency (hospitals, fuel, water, supplies and more), and turn-by-turn directions that can go around roads or areas you mark as blocked.
- **Live navigation** with a USB GPS receiver: where you are, the next turn, your speed, the distance left and the time of arrival.
- **An address book** for the people and places that matter, which can copy your Google or iCloud contacts.
- **One page, Options and Setup,** to choose what to download, see how much room it takes, and fetch it all with one button.
- **A guide for every page**, from the **?** button at the top.
- Wiki golf, for when the work is done.

**New since 0.30.1**

- **Options and Setup.** The Setup and Library pages are one page of folding groups (downloads, where the library is kept, Wikipedia, more libraries, answers, about), each with a flag that says whether it is complete or still needs something.
- **One list and one button for the map.** "Places" and "addresses and more places" are a single *Places* item, fetched ready-made from this project and built from the original sources if that fails. The Map section shows the same regions and the same list as the setup page, with one button; the separate controls are under *Advanced map download settings*.
- **GPS that sets itself up.** Press *Find my GPS receiver* once. After that the receiver connects by itself when Wikivault starts and whenever it is plugged in. A panel in the bottom right corner of the map shows whether it is connected and, when opened, speed, heading, position, satellites and the trip. If a receiver is not found the app says why: no port of its own (not plugged in, or no driver), or a port that is silent.
- **Fixed: a receiver that was found only on some tries.** Small mistakes on the receiver's line were taken for silence, so a receiver that sees many satellites could take several tries to find and could drop out while connected. They are now read past.
- **Addresses looked up online, if you say yes.** A contact with a complete address that the free address data does not have was placed only at its town. The address book now asks once whether such addresses may be looked up with the United States Census Bureau's address service. Only the street address is sent: no name, telephone number or anything else. It is off until you say yes.
- **Fixed:** a town is no longer placed at a town of the same name in another state; the bar for the ready-made places download fills and shows the speed.

**School is in development.** A school section, a full year of lessons laid out week by week, is being built and is not in this version. It is switched off here while it is finished and will arrive in a later release.

**Good to know**

- Windows may say "Windows protected your PC", because the installer is not code-signed. The step-by-step guide says what to press.
- The first downloads are large (Wikipedia alone is tens of gigabytes) and take hours. They can be stopped and carried on.
- After installing over a version older than 0.30, open *Options and Setup* and press the download button once, to get the ready-made places with their sorting and sizes. It takes a minute or two.
- A GPS receiver needs no firmware. Windows has to have set it up as a serial (COM) port, which most do by themselves.
- Looking addresses up online covers the United States and Puerto Rico, and places a house along its street, usually within a few doors.
- Not every address is in the open address data. When one is not, the app places it by its street or its town and says so.

What changed, version by version, is in [CHANGELOG.md](https://github.com/wwmotorsport/WikiVault/blob/main/CHANGELOG.md). How to use everything is in the [user guide](https://github.com/wwmotorsport/WikiVault/blob/main/docs/USER-GUIDE.md).
