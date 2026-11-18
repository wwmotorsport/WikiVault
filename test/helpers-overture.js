'use strict';
// Stand-in Overture Maps files for the tests: small Parquet files laid out like the real ones (zstd
// compression, a bbox for every row, several groups of rows), and the answers of the store they sit in.
const zlib = require('node:zlib');
const { parquetWriteBuffer } = require('hyparquet-writer');

const opt = (name, type, extra = {}) => ({ name, type, repetition_type: 'OPTIONAL', ...extra });
const str = (name) => opt(name, 'BYTE_ARRAY', { converted_type: 'UTF8' });
const group = (name, n, extra = {}) => ({ name, repetition_type: 'OPTIONAL', num_children: n, ...extra });
const listOf = (name, element) => [group(name, 1, { converted_type: 'LIST' }), { name: 'list', repetition_type: 'REPEATED', num_children: 1 }, ...element];
const bbox = [group('bbox', 4), opt('xmin', 'DOUBLE'), opt('xmax', 'DOUBLE'), opt('ymin', 'DOUBLE'), opt('ymax', 'DOUBLE')];

function write(schema, names, rows, rowGroupSize) {
  const buf = parquetWriteBuffer({ columnData: names.map((name) => ({ name, data: rows.map((r) => (r[name] === undefined ? null : r[name])) })), schema, codec: 'ZSTD', compressors: { ZSTD: (b) => zlib.zstdCompressSync(b) }, rowGroupSize });
  return Buffer.from(buf);
}
const at = (lon, lat) => ({ xmin: lon, xmax: lon, ymin: lat, ymax: lat });

const ADDRESS_SCHEMA = [{ name: 'root', num_children: 9 }, str('id'), ...bbox, str('country'), str('postcode'), str('street'), str('number'), str('unit'),
  ...listOf('address_levels', [group('element', 1), str('value')]), str('postal_city')];
const ADDRESS_NAMES = ['id', 'bbox', 'country', 'postcode', 'street', 'number', 'unit', 'address_levels', 'postal_city'];

/** Address rows as Overture gives them. */
function addressRows() {
  const rows = []; let id = 0;
  const add = (street, number, lon, lat, city, state, zip, more = {}) => rows.push({ id: `a${id++}`, bbox: at(lon, lat), country: 'US', postcode: zip || null, street, number: String(number), address_levels: [{ value: state }, city ? { value: city } : {}], ...more });
  // North Main Street in Charlotte: even numbers on one side, odd on the other, with 150 to 160 missing.
  for (let n = 100; n <= 198; n += 2) if (n < 150 || n > 160) add('North Main Street', n, -80.85 + (n - 100) * 0.0001, 35.23, 'Charlotte', 'NC', '28202');
  for (let n = 101; n <= 199; n += 2) add('N MAIN ST', n, -80.85 + (n - 101) * 0.0001, 35.2302, 'Charlotte', 'NC', '28202');
  add('North Main Street', 120, -80.848, 35.23, 'Charlotte', 'NC', '28202', { unit: 'Apt 2' }); // a second flat at a number already given
  // A Main Street in another town, and one whose rows do not name the town.
  for (let n = 1; n <= 40; n++) add('Main St', n, -80.55 + n * 0.0001, 34.98, 'Monroe', 'NC', '28110');
  for (let n = 500; n <= 520; n += 4) add('Oak Hollow Road', n, -80.80 + (n - 500) * 0.0001, 35.30, null, 'NC', null);
  for (let n = 10; n <= 60; n += 10) add('Elm Avenue', n, -80.58 + n * 0.0001, 35.41, null, 'NC', '28025', { postal_city: 'Concord' });
  add('Elm Avenue', '', -80.58, 35.41, 'Concord', 'NC', '28025'); // no number: of no use
  // Far from any region of the app: its groups are never fetched.
  for (let n = 1; n <= 250; n++) rows.push({ id: `e${n}`, bbox: at(2.33 + n * 1e-5, 48.86), country: 'FR', postcode: '75001', street: 'Rue de Rivoli', number: String(n), address_levels: [{ value: 'Paris' }] });
  return rows;
}

const PLACE_SCHEMA = [{ name: 'root', num_children: 9 }, str('id'), ...bbox,
  group('names', 1), str('primary'),
  group('taxonomy', 2), str('primary'), ...listOf('hierarchy', [str('element')]),
  str('basic_category'), opt('confidence', 'DOUBLE'), str('operating_status'),
  ...listOf('addresses', [group('element', 4), str('freeform'), str('locality'), str('postcode'), str('region')]),
  ...listOf('phones', [str('element')])];
const PLACE_NAMES = ['id', 'bbox', 'names', 'taxonomy', 'basic_category', 'confidence', 'operating_status', 'addresses', 'phones'];

function placeRows() {
  const rows = []; let n = 0;
  const add = (name, hierarchy, lon, lat, more = {}) => rows.push({ id: `0000${n++}-aaaa-bbbb-cccc-00000000000${n}`, bbox: at(lon, lat), names: { primary: name }, taxonomy: { primary: hierarchy[hierarchy.length - 1], hierarchy }, basic_category: hierarchy[hierarchy.length - 1], confidence: 0.95, operating_status: 'open', addresses: [{ freeform: '1 Test Rd', locality: 'Charlotte', postcode: '28202', region: 'NC' }], phones: ['+17045550100'], ...more });
  add('Mercy Hospital', ['health_care', 'hospital'], -80.84, 35.21);
  add('Little Ones Hospital', ['health_care', 'hospital', 'childrens_hospital'], -80.83, 35.24);
  add('CVS Pharmacy', ['health_care', 'pharmacy'], -80.8401, 35.2301); // the tests have a "CVS" from OpenStreetMap 20 m away
  add('Corner Drugs', ['health_care', 'pharmacy'], -80.79, 35.27);
  add('Ace Hardware', ['shopping', 'home_and_garden', 'hardware_store'], -80.82, 35.25);
  add('Carolina Arms', ['shopping', 'sporting_goods', 'gun_and_ammo'], -80.81, 35.26);
  add('Pump and Go', ['travel_and_transportation', 'gas_station'], -80.80, 35.22, { phones: null, addresses: null });
  add('Beans', ['food_and_drink', 'cafe'], -80.84, 35.22); // not a kind the app keeps
  add('Gone Hardware', ['shopping', 'hardware_store'], -80.83, 35.22, { operating_status: 'permanently_closed' });
  add('Maybe Hardware', ['shopping', 'hardware_store'], -80.83, 35.23, { confidence: 0.3 });
  add(null, ['shopping', 'hardware_store'], -80.83, 35.231);
  for (let i = 0; i < 120; i++) add(`Quincaillerie ${i}`, ['shopping', 'hardware_store'], 2.3 + i * 1e-4, 48.85);
  return rows;
}

const RELEASE = '2026-10-21.0';

/** The files a stand-in store serves, for `serve()` in helpers-pmtiles, or any server that looks names up by path. */
function overtureFiles({ release = RELEASE, withReleaseList = true } = {}) {
  const files = {
    [`release/${release}/theme=addresses/type=address/part-00000-x.zstd.parquet`]: write(ADDRESS_SCHEMA, ADDRESS_NAMES, addressRows(), 120),
    [`release/${release}/theme=places/type=place/part-00000-y.zstd.parquet`]: write(PLACE_SCHEMA, PLACE_NAMES, placeRows(), 8),
  };
  if (withReleaseList) files['data/releases.json'] = Buffer.from(JSON.stringify({ latest: release, releases: [release, '2026-09-23.0'] }));
  // The store's own listing, asked for at its root with ?list-type=2&prefix=...
  files[''] = (req) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const prefix = q.get('prefix') || '';
    if (q.get('delimiter') === '/') return Buffer.from(`<?xml version="1.0"?><ListBucketResult><Prefix>${prefix}</Prefix><CommonPrefixes><Prefix>release/2026-09-23.0/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>release/${release}/</Prefix></CommonPrefixes><IsTruncated>false</IsTruncated></ListBucketResult>`);
    const mine = Object.keys(files).filter((k) => k.endsWith('.parquet') && k.startsWith(prefix)).sort();
    // Two pages, to exercise the "there is more" part of the listing.
    const token = q.get('continuation-token');
    const page = token ? mine.slice(1) : mine.slice(0, 1);
    const more = !token && mine.length > 1;
    return Buffer.from(`<?xml version="1.0"?><ListBucketResult><Prefix>${prefix}</Prefix>${page.map((k) => `<Contents><Key>${k}</Key><Size>${files[k].length}</Size></Contents>`).join('')}<IsTruncated>${more}</IsTruncated>${more ? '<NextContinuationToken>t&amp;1</NextContinuationToken>' : ''}</ListBucketResult>`);
  };
  return files;
}

const overtureConfig = (origin) => ({ releases: `${origin}/data/releases.json`, bucket: `${origin}/`, minConfidence: 0.7, credit: 'test' });

module.exports = { overtureFiles, overtureConfig, addressRows, placeRows, RELEASE };
