# Places: the two sources compared

Wikivault takes places from two sources. OpenStreetMap's are marked by hand with one tag for one kind. Overture Maps'
come from business listings; the app takes a listing for one of its kinds when the listing's own kind, or a wider kind
above it in Overture's tree, is on the app's list (`assets/maps/registry.json`). The wider kinds bring in places that are
something else.

This is the check of November 2026, on a full download of the United States, Canada and Mexico: 989,884 Overture places
in 22 kinds, beside 824,717 from OpenStreetMap. For each kind the words in Overture's names were compared with the words
in OpenStreetMap's, the most repeated names were listed, and samples were read. The rules that came of it are in
`src/core/place-sort.js` and are applied when the places are read (`MapsLibrary.recordsOf`).

| Kind | Fetched | Kept | Moved out | Left out | What was wrong |
|---|---:|---:|---:|---:|---|
| Hospitals | 52,648 | 16,500 | 36,148 | 0 | Doctors' offices, therapy practices, wards, gift shops: to Clinics |
| Clinics and urgent care | 27,705 | 27,705 | 0 | 0 | Sound (receives the offices) |
| Pharmacies | 86,673 | 86,537 | 136 | 0 | Medical equipment shops: to Medical supplies |
| Veterinary clinics | 55,180 | 54,894 | 0 | 286 | Groomers and kennels out; 3,505 visiting vaccination clinics marked lesser |
| Fire stations | 35,792 | 35,585 | 17 | 190 | Police stations: to Police. Tyre shops, unions, extinguisher firms out |
| Police and sheriff | 22,276 | 21,984 | 59 | 233 | Fire stations: to Fire. Unions, lodges, licence offices out |
| Fuel stations | 157,618 | 155,513 | 0 | 2,105 | Truck scales |
| Bottled gas and propane | 47,557 | 47,557 | 0 | 0 | 44,034 are exchange cages outside shops: kept, marked lesser |
| Supermarkets and grocery | 108,204 | 104,933 | 75 | 3,196 | Restaurants, liquor shops, collection desks out; the shop's fuel pumps to Fuel |
| Wholesale | 1,634 | 1,634 | 0 | 0 | Sound |
| Food banks | 5,083 | 5,083 | 0 | 0 | Sound |
| Department and general stores | 91,289 | 86,699 | 3,958 | 632 | Grocers (Aldi, Save A Lot, Bodega Aurrera): to Supermarkets. Bank counters out |
| Hardware and building supply | 135,067 | 68,454 | 0 | 66,613 | Builders, roofers, trades, makers |
| Farm supplies | 5,336 | 5,073 | 0 | 263 | Greenhouses and grain handlers |
| Outdoor and sporting goods | 70,376 | 29,630 | 1,311 | 39,435 | Gun shops: to Gun shops. Shoe, team, golf, pool, clothes shops out; 8,562 bicycle shops marked lesser |
| Gun and hunting shops | 12 | 12 | 0 | 0 | Overture's own kind supplies almost none; they arrive under Outdoor |
| Airports and airfields | 14,526 | 12,972 | 0 | 1,554 | Gates, terminals, concourses, airline desks |
| Rest areas | 581 | 480 | 101 | 0 | Fleet fuel depots: to Fuel, marked lesser |
| Campsites | 42,382 | 41,750 | 0 | 632 | Mobile home parks, day camps |
| Military sites | 6,269 | 5,198 | 0 | 1,071 | Recruiting offices, veterans' clubs, memorials |
| Town halls and courthouses | 23,676 | 23,676 | 0 | 0 | Sound |

In all: 831,869 kept (56,101 of them marked as a lesser sort), 41,805 moved, 116,210 left out.

## What a lesser sort is

A place that is of the kind, but not what someone asking for the kind most likely wants, and that outnumbers the rest:
a cage of exchange cylinders is propane, but there are thirty to each supplier who fills a tank. These are kept, carry a
word for what they are (`x.kind`), and are flagged `less`. In Ask's list of the nearest, they may not be the whole list:
the three nearest of the full sort are always in it (`planNear` in `src/core/map-ask.js`).

## What is still wrong

- Only the name is to hand, because the fetched record does not keep Overture's own kind. The rules are words in names;
  a place with a plain name ("Greenscape", "Sagesupplyinc") is judged by what its name does not say.
- Hardware and Outdoor keep an Overture place only when its name says what it sells or is a known chain. Real shops with
  plain names are lost from Overture there; OpenStreetMap's are still listed.
- Supermarkets and General stores have a long tail of small businesses with nothing in the name to go by.
- Four kinds have Overture names on the app's list and received nothing or nearly nothing: ambulance stations, power
  plants, medical supplies and ranger stations, and gun shops received twelve. The names on the list do not match what
  Overture uses. Mending that needs the list of kinds Overture did use (kept in `overture.json` as `others` after a
  fetch), and takes effect at the next fetch of the Overture places.

## Doing it again

From 0.28.3 each fetched Overture record keeps Overture's own kind (`k`). After the next fetch, the sorting can go by
kind first and by name only where the kind is too wide, and this check can be repeated by counting kinds, not by
reading names. Records fetched before that have no `k` and are sorted by name alone.
