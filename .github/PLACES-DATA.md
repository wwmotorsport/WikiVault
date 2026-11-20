These files are not the app. They are the places the app shows on its map and uses in Ask, built once a week so that each user fetches about 70 MB in place of 13 GB.

- **What is in them:** hospitals, pharmacies, fuel, shops, fire and police stations and the other kinds of place Wikivault knows, for the United States, Canada and Mexico, sorted into kinds, with the ground each covers where it is drawn as an outline.
- **Where they come from:** OpenStreetMap (© OpenStreetMap contributors, Open Database License), the Overture Maps Foundation (CDLA Permissive 2.0 and others), the Name Suggestion Index (BSD-3-Clause) and Medicare's Hospital General Information (public domain). The OpenStreetMap part is a database derived from OpenStreetMap and is offered under the same Open Database License.
- **How they are made:** by this repository's own code (`scripts/build-central-places.js`), on GitHub's servers. Nothing in them comes from any user's computer.
- `places-manifest.json` lists every file with its size and SHA-256; the app checks each file against it. `build-log.txt` is the record of the last build.

To get the app, see the newest release that is not this one.
