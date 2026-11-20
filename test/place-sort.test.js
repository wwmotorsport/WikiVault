'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sortPlace, sorted, keepsOsm, isHospitalName } = require('../src/core/place-sort');
const { MapsLibrary } = require('../src/core/maps-library');
const mapAsk = require('../src/core/map-ask');

const where = (cat, name) => { const s = sortPlace(cat, name); return !s ? 'out' : `${s.c}${s.less ? ' (lesser)' : ''}`; };

test('hospitals: only places named as hospitals are hospitals; offices and parts of hospitals are clinics', () => {
  for (const n of ['Mercy General Hospital', 'Riverside Medical Center', 'Hôpital Général de Montréal', 'Hospital General Leon', 'Clínica y Hospital Santa Julia', 'Northside Emergency Room', "St. Mary's Children's Hospital"]) { assert.equal(isHospitalName(n), true, n); assert.equal(where('hospital', n), 'hospital', n); }
  for (const n of ['Lakeside Family Medicine', 'Riverside Medical Center Suite 200', 'St. Luke Hospital Sleep Center', 'Oak Animal Hospital', 'Valley Rehabilitation Hospital', 'County Hospital Gift Shop', 'Pine Health Primary Care', 'Harbor Heart & Vascular Institute', 'Pine Health', '']) { assert.equal(isHospitalName(n), false, n); assert.equal(where('hospital', n), 'clinic', n); }
});

test('each kind keeps what belongs, moves what belongs elsewhere, marks the lesser sort and leaves the rest out', () => {
  const cases = [
    ['propane', 'Blue Rhino Propane Exchange', 'propane (lesser)'], ['propane', 'Suburban Propane', 'propane'], ['propane', 'Hill Country Gas Co', 'propane'],
    ['veterinary', 'PetVet Vaccination Clinic', 'veterinary (lesser)'], ['veterinary', 'Frisco Animal Hospital', 'veterinary'], ['veterinary', 'Star Grooming on Fifth', 'out'], ['veterinary', 'RockyVet and Grooming', 'veterinary'], ['veterinary', 'Veterinaria y Estética Canina', 'veterinary'],
    ['fuel', 'CAT Scale', 'out'], ['fuel', 'Shell', 'fuel'], ['fuel', 'Marathon Gas', 'fuel'],
    ['hardware', "Brodie's Top Roofing", 'out'], ['hardware', 'Hauser Homes', 'out'], ['hardware', 'Fossum Electric Ltd', 'out'], ['hardware', 'Ace Hardware', 'hardware'], ['hardware', 'Builders FirstSource', 'hardware'], ['hardware', 'Valley Electrical Supply', 'hardware'], ['hardware', 'Sherwin-Williams', 'hardware'], ['hardware', 'Ferretería Altamirano', 'hardware'], ['hardware', "Lowe's Home Improvement", 'hardware'], ['hardware', 'Madereria El Salto', 'hardware'], ['hardware', 'Hinada Water Treatment Tech Co.', 'out'], ['hardware', 'Greenscape', 'out'], ['hardware', 'Stone Creek Custom Homes', 'out'], ['hardware', 'Leffert Stone Company', 'hardware'], ['hardware', 'Roofing Supply Group', 'hardware'], ['hardware', 'CEMEX', 'hardware'],
    ['outdoor', "Perry's Gun Shop", 'weapons'], ['outdoor', 'Old Glory Firearms', 'weapons'], ['outdoor', 'Red Barn Bait & Guns', 'weapons'], ['outdoor', 'Fairway Golf & Driving Range', 'out'], ['outdoor', 'Lakeside Bait & Tackle', 'outdoor'], ['outdoor', "Dick's Sporting Goods", 'outdoor'], ['outdoor', 'lululemon', 'out'], ['outdoor', "Leslie's Pool Supplies", 'out'], ['outdoor', "Smitty's Bike Shop", 'outdoor (lesser)'], ['outdoor', 'Mt Rogers Outfitters', 'outdoor'], ['outdoor', 'Uncle Sam\'s Army and Navy', 'outdoor'], ['outdoor', 'Zumiez', 'out'], ['outdoor', 'Champs Sports', 'out'], ['outdoor', 'Play It Again Sports', 'outdoor'], ['outdoor', 'The North Face', 'outdoor'], ['outdoor', 'Havana Social Club', 'out'], ['outdoor', 'Socktips', 'out'], ['outdoor', 'Outdoor Power Equipment', 'out'], ['outdoor', 'Islamorada Fishing Charter', 'out'],
    ['farm_supply', 'Metrolina Greenhouses', 'out'], ['farm_supply', 'Tractor Supply Co.', 'farm_supply'], ['farm_supply', 'Dallas Feed, Seed & Oil', 'farm_supply'], ['farm_supply', 'Greenhouse & Farm Supply', 'farm_supply'],
    ['department', 'Aldi', 'supermarket'], ['department', 'Save A Lot', 'supermarket'], ['department', 'Dollar General', 'department'], ['department', 'DG Market', 'supermarket'], ['department', 'Dollar General Market', 'department'], ['department', 'BanCoppel', 'out'], ['department', 'Walmart Supercenter', 'department'],
    ['supermarket', 'Walmart Grocery Pickup and Delivery', 'out'], ['supermarket', "Fry's Fuel Center", 'fuel'], ['supermarket', 'H-E-B Fuel', 'fuel'], ['supermarket', 'Body Fuel Organics', 'supermarket'], ['supermarket', 'Tacos Chava', 'out'], ['supermarket', 'Jerusalem Bakery & Grocery', 'supermarket'], ['supermarket', 'Kroger', 'supermarket'], ['supermarket', 'Abarrotes Lourdes', 'supermarket'],
    ['airfield', 'Gate B38', 'out'], ['airfield', 'Concourse A', 'out'], ['airfield', 'United Airlines', 'out'], ['airfield', 'Denver International Airport', 'airfield'], ['airfield', 'Moraine Airpark', 'airfield'], ['airfield', 'Terminal 1, Example International Airport', 'airfield'], ['airfield', 'Signature Aviation', 'airfield'],
    ['military', 'US Army Recruiting', 'out'], ['military', 'Armed Forces Career Center', 'out'], ['military', 'American Legion Post 1461', 'out'], ['military', 'Army National Guard Armory', 'military'], ['military', 'Fort Example', 'military'],
    ['campsite', 'Shady Oaks Mobile Home Park', 'out'], ['campsite', 'Shady Oaks RV Park', 'campsite'], ['campsite', 'Our Kids Day Camp', 'out'], ['campsite', 'Lakeside Campground', 'campsite'], ['campsite', 'Pines Mobile Home & RV Park', 'campsite'],
    ['fire', 'Osburn Police Department', 'police'], ['fire', 'Union Beach Fire Co. #1', 'fire'], ['fire', 'Peerless Tires', 'out'], ['fire', 'Pacific Coastal Fire Protection Inc.', 'out'], ['fire', 'South Madison County Fire Protection District', 'fire'], ['fire', 'Pelham Professional Firefighters Local 2546', 'out'], ['fire', 'Clinton Fire Department', 'fire'],
    ['police', 'Bryant Fire Department', 'fire'], ['police', 'Union County Sheriff', 'police'], ['police', 'Union City Police Department', 'police'], ['police', 'Fraternal Order of Police Lodge 20', 'out'], ['police', 'Peel Regional Police Association', 'out'], ['police', 'Department of Public Safety Fire Marshal', 'police'], ['police', 'Royal Canadian Mounted Police', 'police'],
    ['rest_area', 'Chevron Commercial Cardlock', 'fuel (lesser)'], ['rest_area', "Love's Travel Stop", 'rest_area'], ['rest_area', 'TA Travel Center', 'rest_area'], ['rest_area', 'Minnesota Welcome Center', 'rest_area'],
    ['pharmacy', "Carmichael's Medical Supply", 'medical_supply'], ['pharmacy', 'Main Street Pharmacy & Medical Supply', 'pharmacy'], ['pharmacy', 'CVS Pharmacy', 'pharmacy'], ['pharmacy', 'Farmacias Similares', 'pharmacy'],
    ['townhall', 'City Hall', 'townhall'], ['food_bank', 'Community Food Pantry', 'food_bank'],
  ];
  for (const [cat, name, want] of cases) assert.equal(where(cat, name), want, `${cat}: ${name}`);
});

test('OpenStreetMap is taken as it is, but for shoe, team and golf shops among its sports shops', () => {
  for (const n of ['Finish Line', 'Champs Sports', 'JD Sports', 'Golf Galaxy', 'Nike Factory Store']) assert.equal(keepsOsm('outdoor', n), false, n);
  for (const n of ["Dick's Sporting Goods", 'REI', 'Academy Sports + Outdoors', 'Bass Pro Shops', 'Some Shop', 'Golf & Guns', '']) assert.equal(keepsOsm('outdoor', n), true, n);
  assert.equal(keepsOsm('hospital', 'Golf Clinic'), true);
});

test('a kind is read from its own list and from the lists its places were fetched under', () => {
  const lists = {
    hospital: [{ i: 'ov1', n: 'Riverside Medical Center' }, { i: 'ov2', n: 'Lakeside Family Medicine' }],
    clinic: [{ i: 'ov3', n: 'Elm Urgent Care' }],
    outdoor: [{ i: 'ov4', n: "Perry's Gun Shop" }, { i: 'ov5', n: 'Lakeside Bait & Tackle' }, { i: 'ov6', n: "Smitty's Bike Shop" }, { i: 'ov7', n: 'lululemon' }],
    weapons: [{ i: 'ov8', n: 'Grimes Gunsmithing' }],
    propane: [{ i: 'ov9', n: 'Blue Rhino Propane Exchange', p: '555' }],
  };
  const read = (k) => lists[k] || [];
  assert.deepEqual(sorted('hospital', read).map((r) => r.n), ['Riverside Medical Center']);
  assert.deepEqual(sorted('clinic', read).map((r) => r.n), ['Elm Urgent Care', 'Lakeside Family Medicine']);
  assert.deepEqual(sorted('weapons', read).map((r) => r.n), ['Grimes Gunsmithing', "Perry's Gun Shop"]);
  assert.deepEqual(sorted('outdoor', read).map((r) => `${r.n}${r.less ? '*' : ''}${r.x ? `:${r.x.kind}` : ''}`), ['Lakeside Bait & Tackle', "Smitty's Bike Shop*:Bicycle shop"]);
  assert.deepEqual(sorted('propane', read), [{ i: 'ov9', n: 'Blue Rhino Propane Exchange', p: '555', x: { kind: 'Cylinder exchange at a shop' }, less: true }]);
  assert.equal(lists.propane[0].less, undefined, 'the fetched list is not changed');
});

test('the library lists the sorted places: a hospital search finds the hospital, and the offices are with the clinics', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wv-sort-'));
  try {
    fs.mkdirSync(path.join(dir, 'overture'), { recursive: true });
    const rec = (i, n, a) => ({ i: `ov${i}`, n, a, o: -80.8, d: '', s: 'ov' });
    const put = (kind, items) => fs.writeFileSync(path.join(dir, 'overture', `${kind}.json`), JSON.stringify({ v: 1, items }));
    put('hospital', [rec(1, 'Lakeside Family Medicine', 35.21), rec(2, 'Pine Health Physical Therapy', 35.22), rec(3, 'Riverside Medical Center', 35.30), rec(4, 'Oak Animal Hospital', 35.23)]);
    put('clinic', [rec(5, 'Elm Urgent Care', 35.24)]);
    put('outdoor', [rec(6, "Perry's Gun Shop", 35.25), rec(7, 'Lakeside Bait & Tackle', 35.26)]);
    fs.writeFileSync(path.join(dir, 'overture.json'), JSON.stringify({ release: 'test', regions: ['east'], date: new Date().toISOString(), total: 7, counts: { hospital: 4, clinic: 1, outdoor: 2 }, bytes: 1 }));
    const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'maps', 'registry.json'), 'utf8'));
    const lib = new MapsLibrary({ dir, registry });
    await lib.init();
    const names = (cat) => lib.search({ categories: [cat], near: [-80.8, 35.2], limit: 10 }).hits.map((h) => `${h.n}:${h.c}`);
    assert.deepEqual(names('hospital'), ['Riverside Medical Center:hospital']);
    assert.deepEqual(names('clinic'), ['Lakeside Family Medicine:clinic', 'Pine Health Physical Therapy:clinic', 'Oak Animal Hospital:clinic', 'Elm Urgent Care:clinic']);
    assert.deepEqual(names('weapons'), ["Perry's Gun Shop:weapons"]);
    assert.deepEqual(names('outdoor'), ['Lakeside Bait & Tackle:outdoor']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Ask: places of a lesser sort do not fill the list of the nearest; the nearest of the full sort are listed with them', () => {
  const home = { lat: 35.2, lon: -80.8, label: 'Home', own: true };
  const cages = Array.from({ length: 30 }, (_, k) => ({ i: `ov${k}`, n: 'Blue Rhino Propane Exchange', a: 35.2 + (k + 1) * 0.002, o: -80.8, c: 'propane', kind: 'Propane', s: 'ov', less: true, x: { kind: 'Cylinder exchange at a shop' } }));
  const yards = [{ i: 'n1', n: 'Suburban Propane', a: 35.5, o: -80.8, c: 'propane', kind: 'Propane' }, { i: 'n2', n: 'Hill Gas Co', a: 35.6, o: -80.8, c: 'propane', kind: 'Propane' }, { i: 'n3', n: 'Valley Propane', a: 35.7, o: -80.8, c: 'propane', kind: 'Propane' }, { i: 'n4', n: 'Far Propane', a: 35.9, o: -80.8, c: 'propane', kind: 'Propane' }];
  const km = (h) => Math.hypot((h.a - home.lat) * 111, (h.o - home.lon) * 91);
  const ctx = {
    saved: (q) => (/^home$/i.test(q) ? [home] : []), contacts: () => [], search: () => [], gps: () => null, kinds: [{ id: 'propane', name: 'Propane' }],
    nearby: ({ limit }) => cages.concat(yards).map((h) => ({ ...h, km: Math.round(km(h) * 10) / 10 })).sort((a, b) => a.km - b.km).slice(0, limit),
  };
  const plan = mapAsk.plan(mapAsk.parseNear('list propane suppliers near home'), ctx);
  assert.equal(plan.kind, 'near'); assert.equal(plan.hits.length, 10);
  assert.deepEqual(plan.hits.filter((h) => !h.less).map((h) => h.n), ['Suburban Propane', 'Hill Gas Co', 'Valley Propane']);
  assert.equal(plan.hits.filter((h) => h.less).length, 7);
  assert.ok(plan.hits.every((h, k, all) => !k || all[k - 1].km <= h.km), 'still nearest first');
  assert.match(plan.notes.join(' '), /lesser sort \(cylinder exchange at a shop\), so the nearest 3 of the full sort are listed/);
  // With enough of the full sort among the nearest already, nothing changes.
  const mixed = { ...ctx, nearby: ({ limit }) => yards.map((h, k) => ({ ...h, a: 35.2 + (k + 1) * 0.001 })).concat(cages).map((h) => ({ ...h, km: Math.round(km(h) * 100) / 100 })).sort((a, b) => a.km - b.km).slice(0, limit) };
  const plain = mapAsk.plan(mapAsk.parseNear('list propane suppliers near home'), mixed);
  assert.equal(plain.hits.filter((h) => !h.less).length, 4); assert.equal(plain.notes.length, 0);
  // Asked for the one nearest, five are listed: two of the lesser sort and the three nearest of the full sort.
  const one = mapAsk.plan(mapAsk.parseNear('where can I get propane near home'), ctx);
  assert.deepEqual(one.hits.map((h) => (h.less ? 'cage' : h.n)), ['cage', 'cage', 'Suburban Propane', 'Hill Gas Co', 'Valley Propane']);
});
