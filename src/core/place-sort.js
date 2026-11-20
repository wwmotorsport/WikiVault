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
const NOT_BASE = words("recruiting|recruiters?|recruitment|career cent(?:er|re)|careers|legion|vfw|veterans?|amvets|memorials?|museums?|surplus|cemetery|monument|rotc|jrotc|cadets?|academy of|school");

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
    case 'military': return NOT_BASE.test(n) ? null : keep('military');
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
 * OpenStreetMap's places are tagged by hand and are taken as they are, with one exception: its "sports shop" is as wide
 * as Overture's, so a shop whose name says it sells shoes, team clothes or golf clubs is not listed as an outdoor shop.
 */
function keepsOsm(cat, name) {
  if (cat !== 'outdoor') return true;
  const n = fold(name);
  return !(NOT_OUTDOOR.test(n) && !OUTDOOR.test(n) && !GUNS.test(n));
}

// Which kinds can receive places that were fetched under another kind.
const FROM = { clinic: ['hospital'], weapons: ['outdoor'], supermarket: ['department'], fuel: ['supermarket', 'rest_area'], police: ['fire'], fire: ['police'], medical_supply: ['pharmacy'] };

/**
 * The Overture places of one kind, from the lists as they were fetched: `read(kind)` gives a fetched list.
 * Places that belong elsewhere are not in it; places that belong here but were fetched under another kind are.
 */
function sorted(id, read) {
  const out = [];
  for (const src of [id, ...(FROM[id] || [])]) {
    for (const r of read(src)) {
      const s = sortPlace(src, r.n);
      if (!s || s.c !== id) continue;
      if (s.kind || s.less) { const x = { ...r, x: { ...(r.x || {}), ...(s.kind ? { kind: s.kind } : {}) } }; if (s.less) x.less = true; out.push(x); } else out.push(r);
    }
  }
  return out;
}

module.exports = { sortPlace, sorted, keepsOsm, isHospitalName, FROM };
