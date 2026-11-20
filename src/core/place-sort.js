'use strict';
// Maps: putting the places from Overture Maps under the right kind.
//
// OpenStreetMap's places are tagged by hand, one kind at a time, and are taken as they are. Overture's come from
// business listings, and the app takes a place for one of its kinds when the listing's own kind, or a wider kind above
// it, is on the app's list. The wider kinds bring in a great many places that are something else: a doctor's office
// under "hospital", a roofer under "hardware", an airport gate under "airfield". A check of a real download (the
// United States, Canada and Mexico, 1.0 million Overture places) found the groups below, and this is where each goes.
//
// A place is kept, moved to another kind, marked as a lesser sort of its kind (kept, named for what it is, and not
// allowed to fill a list of the nearest on its own), or left out. Only the name is to hand, so the rules are words in
// names, in English, French and Spanish. They are applied when the places are read: nothing is fetched again.

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (list) => new RegExp(`\\b(?:${list})\\b`);

// Hospitals. 36,000 of 52,000 were offices and parts of hospitals.
const HOSPITAL_YES = words('hospitals?|medical cent(?:er|re)s?|med(?:ical)? ctr|regional medical|health cent(?:er|re)|emergency (?:room|department|cent(?:er|re))|infirmary|trauma cent(?:er|re)|hopital|centre hospitalier|hospitalier|sanatorio');
const HOSPITAL_NO = words("suite|ste|primary care|family (?:medicine|practice|health)|internal medicine|pediatrics?|paediatrics?|ob\\/?gyn|obstetrics|gynecolog\\w*|women'?s (?:care|health)|physical therapy|physiotherap\\w*|rehab\\w*|sports medicine|orthop\\w*|dermatolog\\w*|urgent care|sleep|endoscopy|imaging|radiolog\\w*|breast|vein|spine|neuro\\w*|cardiolog\\w*|oncolog\\w*|cancer|dental|dentist\\w*|eye|vision|hearing|audiolog\\w*|chiropract\\w*|pharmacy|laborator\\w*|lab|associates|institute|group|practice|clinic|office|unit|animal|veterinar\\w*|pet|vet|gift shop|cafeteria|parking|foundation|auxiliary|volunteer\\w*|school of|college of|department of|dept|outpatient|dialysis|hospice|home health|nursing|assisted living|senior living|behavioral|psychiatr\\w*|counsel\\w*|therapy|wellness|weight loss|plastic surgery|surgery cent(?:er|re)|surgical|urolog\\w*|gastro\\w*|allerg\\w*|podiatr\\w*|foot|pain|diabetes|medical supply|equipment|billing|records|human resources|careers|jobs");
/** Whether a place's name is that of a hospital, and not of an office or a part of one. */
function isHospitalName(name) {
  const n = fold(name);
  return HOSPITAL_YES.test(n) && !HOSPITAL_NO.test(n);
}

// Propane. 44,000 of 47,500 were cages of exchange cylinders outside shops.
const TANK_EXCHANGE = words('blue rhino|propane exchange|tank exchange|cylinder exchange|amerigas (?:propane )?exchange');

// Animal care. 3,500 were vaccination clinics that visit a pet or farm shop for a few hours.
const VACCINATION = words('vaccination clinics?|vaccine clinics?|shot clinics?|vax');
const GROOMING = words('grooming|groomers?|estetica|peluqueria|boarding|kennels?|kennelz|daycare|training|pet ?sitting|dog walking|pet (?:store|shop|supplies)');
const VET = /vets?\b|veterinar|\b(?:animal (?:hospital|clinic|medical|care|health|emergency)|pet (?:hospital|clinic|emergency|care)|dvm|equine|hospital|clinic|clinica|clinique)\b/;

// Fuel. 2,100 were truck scales.
const SCALE = words('cat scale|public scales?|truck scales?|weigh station');

// Hardware and building supplies. Of 135,000, half were builders, trades and makers, who sell work and not goods;
// no list of trades catches them all, so here too the name has to say what the shop is, or be a known chain.
const TRADES = words("roofing|roofers?|construction|constructora|contracting|contractors?|painting|painters?|landscaping|landscapes?|lawn care|tree service|heating|cooling|hvac|air conditioning|remodeling|remodelling|renovations?|restoration|repairs?|handyman|home builders?|custom homes|homes|designs?|interiors?|cabinets?|cabinetry|countertops?|granite|marble|flooring|floors|kitchens?|baths?|fenc(?:e|es|ing)|decks?|siding|gutters?|insulation|drywall|masonry|paving|excavating|excavation|foundation|waterproofing|plumbers?|electricians?|solar|pools?|spas?|welding|fabrication|engineering|architects?|consulting|services?|servicios|installations?|installers?|cleaning|pest control|realty|real estate|properties|developers?|fulfillment cent(?:er|re)|distribution cent(?:er|re)|headquarters|corporate office");
const HARDWARE = words("hardware|suppl(?:y|ies)|lumber|lumberyard|building (?:suppl(?:y|ies)|materials?|products|cent(?:er|re))|builders? suppl(?:y|ies)|home improvement|home cent(?:er|re)s?|ferreteria|ferre\\w+|tlapaleria|madereria|quincaillerie|materiales|bricolage|do it best|true value|ace|home depot|lowe'?s|menards|harbor freight|tractor supply|northern tool|fastenal|grainger|84 lumber|rona|bmr|canac|canadian tire|princess auto|home hardware|timber mart|rural king|bomgaars|orscheln|sutherlands|mccoy'?s|valu home|home outlet|busy beaver|restore|sherwin\\W?williams|benjamin moore|ppg|dulux|comex|firstsource|abc supply|srs|white cap|qxo|bluelinx|probuild|carter lumber|construrama|cemex");
const HARDWARE_GOODS = words("materials?|tools?|depot|paints?|pinturas|mercantile|general store|bricks?|blocks?|redi-?mix|ready[- ]mix|concrete|cement|cemento|sand|gravel|stone|aggregates?|plywood|timber|truss(?:es)?|fasteners?|bolts?|steel|metals?|pipe|farm cent(?:er|re)|sawmill");

// Outdoor and sporting goods. Of 70,000: gun shops (which belong with the gun shops), and clothes, team, golf, pool
// and bicycle shops, and any business near sport. The name has to say it sells outdoor or sporting goods, or be a known chain.
const GUNS = words("guns?|firearms?|armory|armoury|arms|ammo|ammunition|gunsmith\\w*|shooting|shooters?|range|tactical|defense|pawn|rifles?|pistols?|armeria");
const NOT_OUTDOOR = words("lululemon|athleta|fabletics|nike|adidas|puma|reebok|asics|new balance|under armour|foot locker|champs|jd sports|finish line|hibbett|rally house|lids|fanatics|fanzz|alumni hall|fan (?:shop|hq|zone|cave)|team (?:store|shop)|pro shop|sportswear|apparel|activewear|swimwear|uniforms?|jerseys?|sneakers?|shoes?|running|runners?|dance|dancewear|cheer|gymnastics|yoga|pilates|fitness|gym|crossfit|martial arts|karate|golf|tennis|pickleball|hockey|lacrosse|soccer|futbol|baseball|softball|basketball|football|bowling|billiards?|skate|skateboards?|skatepark|surf|surfboards?|snowboards?|pools?|spas?|hot tubs?|trophy|trophies|awards|embroidery|screen printing|lawn|mowers?|power equipment|small engine|bobcat|golf carts?|powersports|motorsports|motorcycles?|atv|cards|collectibles|memorabilia|nutrition|supplements|bar|grill|club|school|academy of|complex|arena|stadium|park|medicine|physical therapy|chiropractic");
const BICYCLE = words("bicycles?|bikes?|cycles?|cyclery|cycling|ebikes?|e-bikes?|trek|velo|bicicletas?");
const OUTDOOR = words("outdoors?|outdoors?m[ae]n|outfitters?|camping|hunting|fishing|bait|tackle|archery|army|navy|surplus|sporting goods|sportsman'?s?|sportsmen'?s?|bass pro|cabela'?s|rei|academy sports|dick'?s|big 5|dunham'?s|scheels|sierra|north face|l\\.?l\\.? ?bean|patagonia|orvis|field & stream|mec|eddie bauer|arc'?teryx|columbia|public lands|sail|decathlon|gander|canoes?|kayaks?|fly shop|anglers?|scuba|dive|divers?|climbing|backpack\\w*|chasse|peche|plein air|caza|pesca|decoys?|saddlery|tack");
const NEAR_OUTDOOR = words("outdoor power|outdoor (?:living|lighting|kitchens?|furniture|advertising|services?|solutions|design)|charters?|guide service|tours?|rentals?");
const SPORTS = words("sports?|sporting|deportes|gear|marine|mountain|trail|wilderness|expedition|adventures?|ski|skis");

// General and department stores. Some 5,000 were grocers, which belong with the supermarkets; a few hundred were bank counters and cash machines.
const GROCER = words("aldi|save[- ]a[- ]lot|bodega aurrera|provigo|grocery outlet|food lion|supermarket|supermercado|super ?mercado|grocery|groceries|abarrotes|foods?|market|mercado|epicerie");
const MONEY = words("bancoppel|bank|banco|atm|bitcoin|coin|western union|moneygram|check cashing|payday|loans?");

// Supermarkets and grocers. Places to eat, the shop's own fuel pumps, and its collection desk.
const EATING = words("restaurants?|restaurante|grill|taqueria|tacos?|pizza|pizzeria|cafe|coffee|bakery|panaderia|bar|pub|bistro|diner|kitchen|cocina|buffet|sushi|bbq|barbecue|burgers?|wings|catering|ice cream|donuts?|juice|smoothies?|liquor|wine|spirits|beer|vape|tobacco|smoke shop");
const PICKUP = words("pickup(?: and| &)? delivery|grocery pickup|curbside");
const FUEL = words("fuel (?:cent(?:er|re)|station|stop)|gas station|gas bar|gasolinera|petroleum|cardlock");
const FUEL_END = /\bfuel$/;

// Airfields. 2,500 were parts of an airport and the firms in it.
const IN_AIRPORT = words("gates?|terminals?|concourses?|baggage|arrivals?|departures?|check-?in|checkin|ticketing|security checkpoint|tsa|lounges?|admirals club|sky club|united club|airlines?|airways|jetblue|jet blue|southwest|supershuttle|shuttle|parking|car rental|rent a car|hertz|avis|cell phone lot|customs|aduana|flight (?:training|school)|balloon rides?|helicopter (?:tours?|experience)|skydiv\\w*|air tours?");
const AIRFIELD = words("airports?|aeropuertos?|aeroport|aerodromes?|aerodromo|airfields?|airparks?|air park|airstrips?|heliports?|helipads?|helipuerto|seaplane base|air ?base|afb|field|aviation|fbo");

// Military sites. 900 were recruiting offices in shopping streets; others were clubs and memorials.
const NOT_BASE = words("recruiting|recruiters?|recruitment|retention|career cent(?:er|re)|careers|entrance processing|meps|legion|vfw|veterans?|amvets|memorials?|museums?|surplus|cemetery|monument|rotc|jrotc|cadets?|academy of|school|high|college|university");
// A recruit depot trains recruits; it is a base.
const BASE_ALL_THE_SAME = words("recruit depot|recruit training|military academy|naval academy|air force academy|coast guard academy");
// Overture's military kind holds nicknames and odd listings: a place from it must say what it is.
const MILITARY = words("army|navy|naval|air force|afb|marines?|marine corps|usmc|coast guard|uscg|national guard|guard|fort|camp|base|reserve|armory|armoury|arsenal|depot|military|militar|barracks|proving ground|range|training|command|battalion|brigade|squadron|regiment|division|airfield|air station|station|garrison|readiness|defen[cs]e|forces?|cfb|bfc|zona militar|cuartel");
// Places where part-time units meet, and offices: military, but not what someone asking for a base is after.
const UNIT_HALL = words("reserve cent(?:er|re)|reserve training cent(?:er|re)|army reserve|navy reserve|marine corps reserve|armory|armoury|readiness cent(?:er|re)|national guard|guard|recruit sustainment|training command|corps of engineers");

// Campsites. 1,200 were places people live in all year, or day camps for children.
const NOT_CAMP = words("mobile home|manufactured home|mhp|mobile estates?|mobile village|mobile court|apartments?|residential|properties|realty|day camp|summer camp|camp galileo|scouts canada|shopping");

// Farm supplies. A few hundred were growers and grain handlers.
const NOT_FARM_SHOP = words("greenhouses?|invernadero|nursery|grain and barge|milling|commodities|grain marketing");
const FARM_SHOP = words("feed|seed|suppl(?:y|ies)|farm|tractor|equipment|implement|co-?op|coop|agri\\w*|ag|fertilizer");

// Fire and police. A few hundred of each were filed under the other, or were suppliers and clubs.
const FIRE = words("fire|bomberos|pompiers|incendies?|firehouse|vfd|vfc|hose|engine|ladder");
const POLICE = words("police|policia|sheriff'?s?|constable|state patrol|highway patrol|troopers?|rcmp|gendarmerie|surete|marshals?");
const FIRE_TRADE = words("extinguishers?|sprinklers?|fire protection (?:inc|llc|co|services?|systems?)|alarm|alarms|equipment|equipos|sales|distributors|restoration|tires|training cent(?:er|re)|museum|credit union|iaff|professional fire ?fighters|fire ?fighters (?:local|union|association)|local \\d+|meeting room|christmas tree");
const POLICE_NOT = words("police union|officers'? union|pba|fop|fraternal order|lodge|benevolent|associations?|museum|memorial|mural|upfitting|recruiting|cops shop|collision reporting|bmv|license agency|driver exam|road department|public works");

// Rest areas. A few hundred were fuel depots for lorry fleets.
const CARDLOCK = words("cardlock|commercial|fuels|oil|energy|pipeline|irving 24|express 24");
const REST = words("rest (?:area|stop)|travel (?:cent(?:er|re)|plaza|stop)|truck stop|welcome cent(?:er|re)|service (?:area|plaza|centre|center)|plaza|oasis|onroute|love'?s|ta|petro|pilot|flying j|parador|aire de");

// Pharmacies. Some 800 were shops for medical equipment.
const MED_SUPPLY = words("medical suppl(?:y|ies)|medical equipment|home medical|orthotics?|prosthetics?|orthopedic suppl\\w*|mobility|oxygen|scrubs");
const PHARMACY = words("pharmac\\w*|farmac\\w*|drugs?|drugstore|rx|apothecary|chemist|botica|drogueria");

const keep = (c) => ({ c });
const lesser = (c, kind) => ({ c, kind, less: true });

/**
 * Where a place from Overture belongs. `cat` is the kind it was fetched under.
 * Returns `{ c, kind?, less? }`: the kind it is listed under, a word for what it is when that is narrower than the
 * kind, and whether it is a lesser sort of that kind. Returns null for a place that is none of the app's kinds.
 */
function sortPlace(cat, name) {
  const n = fold(name);
  switch (cat) {
    case 'hospital': return HOSPITAL_YES.test(n) && !HOSPITAL_NO.test(n) ? keep('hospital') : keep('clinic');
    case 'propane': return TANK_EXCHANGE.test(n) ? lesser('propane', 'Cylinder exchange at a shop') : keep('propane');
    case 'veterinary':
      if (VACCINATION.test(n)) return lesser('veterinary', 'Visiting vaccination clinic');
      return GROOMING.test(n) && !VET.test(n) ? null : keep('veterinary');
    case 'fuel': return SCALE.test(n) ? null : keep('fuel');
    case 'hardware': return HARDWARE.test(n) || (HARDWARE_GOODS.test(n) && !TRADES.test(n)) ? keep('hardware') : null;
    case 'outdoor':
      if (GUNS.test(n) && !/\b(?:driving range|golf)\b/.test(n)) return keep('weapons');
      if (NEAR_OUTDOOR.test(n)) return null;
      if (OUTDOOR.test(n)) return keep('outdoor');
      if (NOT_OUTDOOR.test(n)) return null;
      if (BICYCLE.test(n)) return lesser('outdoor', 'Bicycle shop');
      return SPORTS.test(n) ? keep('outdoor') : null;
    case 'department':
      if (MONEY.test(n)) return null;
      return GROCER.test(n) && !/\b(?:dollar|general store|walmart|target|kmart|big lots|ollie'?s|five below)\b/.test(n) ? keep('supermarket') : keep('department');
    case 'supermarket':
      if (PICKUP.test(n)) return null;
      if (FUEL.test(n) || FUEL_END.test(n)) return keep('fuel');
      return EATING.test(n) && !/\b(?:market|mercado|grocery|groceries|supermarket|abarrotes|foods?|tienda|carniceria|deli)\b/.test(n) ? null : keep('supermarket');
    case 'airfield': return IN_AIRPORT.test(n) && !AIRFIELD.test(n) ? null : keep('airfield');
    case 'military':
      if (NOT_BASE.test(n) && !BASE_ALL_THE_SAME.test(n)) return null;
      if (!MILITARY.test(n)) return null;
      return UNIT_HALL.test(n) && !/\b(?:base|fort|camp|air national guard base|joint)\b/.test(n) ? lesser('military', 'Reserve or National Guard hall') : keep('military');
    case 'campsite': return NOT_CAMP.test(n) && !/\b(?:rv|campground|camping|koa)\b/.test(n) ? null : keep('campsite');
    case 'farm_supply': return NOT_FARM_SHOP.test(n) && !FARM_SHOP.test(n) ? null : keep('farm_supply');
    case 'fire':
      if (POLICE.test(n) && !FIRE.test(n)) return keep('police');
      return FIRE_TRADE.test(n) && !/\b(?:department|dept|station|district|rescue|vfd|vfc|bomberos)\b/.test(n) ? null : keep('fire');
    case 'police':
      if (FIRE.test(n) && !POLICE.test(n) && !/\bpublic safety\b/.test(n)) return keep('fire');
      return POLICE_NOT.test(n) ? null : keep('police');
    case 'rest_area': return CARDLOCK.test(n) && !REST.test(n) ? lesser('fuel', 'Fuel depot for fleets (may need an account card)') : keep('rest_area');
    case 'pharmacy': return MED_SUPPLY.test(n) && !PHARMACY.test(n) ? keep('medical_supply') : keep('pharmacy');
    default: return keep(cat);
  }
}

/**
 * OpenStreetMap's places are tagged by hand and are taken as they are, with two exceptions. Its "sports shop" is as wide
 * as Overture's, so a shop whose name says it sells shoes, team clothes or golf clubs is not listed as an outdoor shop.
 * And its military land includes recruiting offices and school cadet units, which are not military sites to anyone looking for one.
 */
function keepsOsm(cat, name) {
  const n = fold(name);
  if (cat === 'military') return !(NOT_BASE.test(n) && !BASE_ALL_THE_SAME.test(n));
  if (cat !== 'outdoor') return true;
  return !(NOT_OUTDOOR.test(n) && !OUTDOOR.test(n) && !GUNS.test(n));
}

/**
 * A lesser sort among OpenStreetMap's places, told by name or by size: `{ kind }` or null. Military land is mapped
 * down to single buildings and half-acre lots; a hall where a reserve unit meets is not a base, and nor is anything
 * under five acres.
 */
function osmLesser(cat, r) {
  if (cat !== 'military') return null;
  const n = fold(r.n);
  if (UNIT_HALL.test(n) && !/\b(?:base|fort|camp|joint)\b/.test(n)) return { kind: 'Reserve or National Guard hall' };
  if (r.m && r.m < 20000) return { kind: 'Small military site' };
  return null;
}

// ---- Brands -------------------------------------------------------------------------------------------------------
// The Name Suggestion Index (nsi.guide, BSD licence) is OpenStreetMap's list of brands, each with the tags a place of
// that brand should carry: Aldi is shop=supermarket, CAT Scale is amenity=weighbridge. For the third of Overture's
// places that are branches of a chain, it says what the place is with no guessing. A cut of it for North America is
// packed with the app (assets/maps/brands.json) and a fresh one is fetched when places are.

const foldBrand = (s) => fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/** The index as fetched, cut down to what sorting needs: for each brand name and Wikidata id, the tags of the brand. */
function reduceBrands(nsiJson, version = '') {
  const names = {}; const ids = {};
  const add = (into, key, tag) => { if (!key) return; const l = into[key] || (into[key] = []); if (!l.includes(tag)) l.push(tag); };
  for (const [where, group] of Object.entries((nsiJson && nsiJson.nsi) || {})) {
    if (!where.startsWith('brands/')) continue;
    const tag = where.split('/').slice(1).join('=');
    for (const it of group.items || []) {
      const inc = ((it.locationSet && it.locationSet.include) || []).map((x) => String(x).toLowerCase());
      if (!inc.some((x) => x === '001' || x === '019' || x === '021' || /^(us|ca|mx)\b/.test(x))) continue;
      const t = it.tags || {};
      for (const n of [it.displayName, t.name, t.brand, ...(it.matchNames || [])]) add(names, foldBrand(n), tag);
      if (/^Q\d+$/.test(t['brand:wikidata'] || '')) add(ids, t['brand:wikidata'], tag);
    }
  }
  return { version: version || (nsiJson && nsiJson._meta && nsiJson._meta.version) || '', names, ids };
}

// What a brand's tag means here: the kinds it fits (the first is where a place is moved to), or nothing of ours.
const fits = (...c) => ({ c });
const BRAND_TAGS = {
  'amenity=fuel': fits('fuel'), 'amenity=pharmacy': fits('pharmacy'), 'shop=chemist': fits('pharmacy'),
  'shop=supermarket': fits('supermarket'), 'shop=greengrocer': fits('supermarket'),
  'shop=department_store': fits('department'), 'shop=variety_store': fits('department'), 'shop=general': fits('department'),
  'shop=doityourself': fits('hardware'), 'shop=hardware': fits('hardware'), 'shop=trade': fits('hardware'),
  'shop=paint': { c: ['hardware'], kind: 'Paint shop', less: true },
  'shop=country_store': fits('farm_supply', 'hardware'), 'shop=agrarian': fits('farm_supply'),
  'shop=outdoor': fits('outdoor'), 'shop=sports': fits('outdoor'),
  'shop=bicycle': { c: ['outdoor'], kind: 'Bicycle shop', less: true },
  'shop=weapons': fits('weapons'), 'shop=hunting': fits('weapons', 'outdoor'), 'shop=fishing': fits('outdoor'),
  'shop=wholesale': fits('wholesale'), 'shop=gas': fits('propane'),
  'amenity=vending_machine': { c: ['propane'], kind: 'Cylinder exchange at a shop', less: true, only: ['propane'] },
  'amenity=veterinary': fits('veterinary'), 'amenity=clinic': fits('clinic'), 'amenity=doctors': fits('clinic'), 'amenity=hospital': fits('hospital'),
  'shop=medical_supply': fits('medical_supply'), 'tourism=camp_site': fits('campsite'), 'tourism=caravan_site': fits('campsite'),
  'highway=services': fits('rest_area', 'fuel'), 'highway=rest_area': fits('rest_area'),
  // A corner shop is none of the map's kinds, but many sell fuel or groceries: its brand settles nothing.
  'shop=convenience': null,
};
// Tags of a brand that is plainly none of the map's kinds. A tag in neither list (a tyre bay, an optician) is passed
// over: big shops have many departments, and the index lists them all under the one name.
const BRAND_OUT = new Set(['amenity=weighbridge', 'shop=clothes', 'shop=shoes', 'shop=fashion_accessories', 'shop=swimming_pool', 'shop=houseware', 'shop=furniture', 'shop=interior_decoration', 'shop=mobile_phone', 'shop=electronics', 'shop=nutrition_supplements', 'shop=alcohol', 'shop=flooring', 'shop=tiles', 'shop=plant_hire', 'shop=car_repair', 'shop=pet', 'shop=gift', 'shop=hearing_aids', 'shop=storage_rental', 'amenity=bank', 'amenity=atm', 'amenity=money_transfer', 'amenity=post_office', 'amenity=fast_food', 'amenity=restaurant', 'amenity=cafe', 'amenity=ice_cream', 'amenity=car_rental', 'amenity=training', 'healthcare=laboratory', 'tourism=hotel', 'office=insurance']);
// A sandwich counter inside a filling station does not make the station a sandwich shop.
const EATS = new Set(['amenity=fast_food', 'amenity=restaurant', 'amenity=cafe', 'amenity=ice_cream']);
const WITH_EATS = new Set(['fuel', 'rest_area']);
// A pharmacy counter inside a supermarket is a pharmacy, and pumps outside one are fuel: the brand of the shop around
// them does not move the place.
const BRAND_NO_MOVE = new Set(['pharmacy', 'fuel', 'rest_area']);
// Brands are shops and chains: the index has nothing to say of a fire station, and a clothes brand called "Police" exists.
const BRAND_KINDS = new Set(['hospital', 'clinic', 'pharmacy', 'medical_supply', 'veterinary', 'fuel', 'propane', 'supermarket', 'wholesale', 'department', 'hardware', 'farm_supply', 'outdoor', 'weapons', 'rest_area', 'campsite']);
const FUELISH = /\b(?:gas|gasolin\w*|fuels?|petrol\w*|diesel)\b/;

/** What the brand says of a place now under `cat`: 'keep', `{ c, kind?, less? }` to move or mark it, 'out', or null for no opinion. */
function byBrand(cat, name, brands, id) {
  if (!brands || !BRAND_KINDS.has(cat)) return null;
  const sure = Boolean(id && brands.ids && brands.ids[id]);
  const tags = sure ? brands.ids[id] : brands.names && brands.names[foldBrand(name)];
  if (!tags || !tags.length) return null;
  let move = null; let open = false; let out = false;
  for (const tag of tags) {
    if (BRAND_OUT.has(tag)) { if (!(EATS.has(tag) && WITH_EATS.has(cat))) out = true; continue; }
    if (!(tag in BRAND_TAGS)) continue;
    const m = BRAND_TAGS[tag];
    if (!m) { open = true; continue; }             // settles nothing
    if (m.only && !m.only.includes(cat)) continue;
    if (m.c.includes(cat)) return m.kind ? { c: cat, kind: m.kind, less: m.less } : 'keep';
    // Of several kinds a big brand covers, the shop itself comes before its pharmacy counter or its pumps.
    if (!move || ((move.c[0] === 'fuel' || move.c[0] === 'pharmacy') && m.c[0] !== 'fuel' && m.c[0] !== 'pharmacy')) move = m;
  }
  if (open) return null;
  if (move && !BRAND_NO_MOVE.has(cat)) {
    // Brand names collide (Puma the fuel company, Puma the shoe maker): by name alone, a place is moved in with the
    // fuel stations only when its name speaks of fuel.
    if (move.c[0] !== 'fuel' || sure || FUELISH.test(fold(name))) return { c: move.c[0], kind: move.kind, less: move.less };
    return null;
  }
  return out ? 'out' : null;
}

// Overture kinds that say enough on their own: the name is not asked to confirm them.
const TRUSTED = new Set(['emergency_department', 'outdoor_store', 'hunting_and_fishing_store', 'archery_store', 'army_and_navy_store', 'military_surplus_store', 'tactical_supply_store', 'gun_and_ammo_store', 'gunsmith', 'bike_store', 'dive_store', 'ski_and_snowboard_store', 'paint_store', 'electrical_supply_store', 'welding_supply_store', 'veterans_hospital', 'childrens_hospital', 'psychiatric_hospital', 'rehabilitation_hospital', 'long_term_care_hospital', 'specialty_hospital', 'medical_supply_store', 'ambulance_or_ems_service', 'warehouse_club_store', 'lumber_store']);

/**
 * Where a place from Overture goes, by all that is known of it, strongest first: the brand, Overture's own kind
 * (`at` is what the app's list makes of that kind: `{ c, kind?, less? }`), and last the words of the name.
 * Returns `{ c, kind?, less?, by }`, or null for a place that is none of the map's kinds.
 */
function settle(at, name, { own = '', brands = null, brandId = '' } = {}) {
  const b = byBrand(at.c, name, brands, brandId);
  // A maker of outdoor clothes is listed by the index as a clothes shop; its shops are outdoor shops all the same.
  if (b === 'out' && !(at.c === 'outdoor' && OUTDOOR.test(fold(name)))) return null;
  if (b && b !== 'keep' && b !== 'out') return { c: b.c, ...(b.kind ? { kind: b.kind } : {}), ...(b.less ? { less: true } : {}), by: 'brand' };
  if (b === 'keep') return { ...at, by: 'brand' };
  if (own && TRUSTED.has(own)) {
    // A hunting shop named for its guns is listed with the gun shops.
    if (at.c === 'outdoor' && !at.less && GUNS.test(fold(name))) return { c: 'weapons', by: 'name' };
    return { ...at, ...(own === 'emergency_department' ? { kind: 'Emergency department' } : {}), by: 'kind' };
  }
  const s = sortPlace(at.c, name);
  if (!s) return null;
  if (s.c !== at.c) return { ...s, by: 'name' };
  return { c: at.c, ...(s.kind || at.kind ? { kind: s.kind || at.kind } : {}), ...(s.less || at.less ? { less: true } : {}), by: s.kind || s.less ? 'name' : 'kind' };
}

// Which kinds can receive places that were fetched under another kind.
// With brands, a place can be moved from any kind to any other, so every list is read for every kind the first time.
const FROM = { clinic: ['hospital'], weapons: ['outdoor'], supermarket: ['department', 'wholesale', 'farm_supply'], fuel: ['supermarket', 'rest_area'], police: ['fire'], fire: ['police'], medical_supply: ['pharmacy', 'hospital'], department: ['hardware', 'farm_supply', 'outdoor'], hardware: ['farm_supply', 'outdoor'], farm_supply: ['hardware'], wholesale: ['supermarket', 'department'], outdoor: ['campsite'], pharmacy: ['clinic'] };

/**
 * The Overture places of one kind, from lists fetched before 0.29 (which were not sorted when fetched, and do not keep
 * Overture's own kind): `read(kind)` gives a fetched list, and the brand and the name are all there is to go by.
 * Places that belong elsewhere are not in it; places that belong here but were fetched under another kind are.
 */
function sorted(id, read, brands = null) {
  const out = [];
  for (const src of [id, ...(FROM[id] || [])]) {
    for (const r of read(src)) {
      const s = settle({ c: src }, r.n, { brands });
      if (!s || s.c !== id) continue;
      if (s.kind || s.less) { const x = { ...r, x: { ...(r.x || {}), ...(s.kind ? { kind: s.kind } : {}) } }; if (s.less) x.less = true; out.push(x); } else out.push(r);
    }
  }
  return out;
}

module.exports = { sortPlace, sorted, settle, byBrand, reduceBrands, foldBrand, keepsOsm, osmLesser, isHospitalName, FROM, TRUSTED };
