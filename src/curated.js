// Offline backup: real, well-known spots so the demo still makes sense with no internet / no LLM.
// Live mode replaces this with Claude Code web research (reviews + sources). "why" lines here are
// general "known for" notes, not quoted reviews.
export const TRIPS = {
  kashmir: {
    name: 'Kashmir', area: 'Srinagar', origin: 'Delhi',
    transport: [
      { mode: 'Flight to Srinagar', detail: 'Delhi ⇄ Srinagar (SXR), ~1.5h', cost: 9500, tags: ['fast'] },
      { mode: 'Vande Bharat to Katra + cab', detail: 'Delhi → Katra train, then cab via the Chenab bridge route', cost: 5200, tags: ['budget', 'scenic'] },
    ],
    stays: [
      { name: 'Dal Lake houseboat', area: 'Dal Lake, Srinagar', type: 'Houseboat', perNight: 3500, why: 'The Kashmir experience. You wake up on the lake and shikaras come to you.', tags: ['chill', 'photos'] },
      { name: 'Zostel Srinagar', area: 'Srinagar', type: 'Hostel private room', perNight: 1600, why: 'Backpacker-friendly, social vibe, easy on the wallet.', website: 'https://www.zostel.com/zostel/srinagar/', tags: ['budget', 'social'] },
      { name: 'Khyber Himalayan Resort & Spa', area: 'Gulmarg', type: 'Luxury resort', perNight: 14000, why: 'The splurge pick in Gulmarg, ski-in vibes and mountain views from every room.', website: 'https://www.khyberhotels.com/', tags: ['luxury', 'snow'] },
    ],
    places: [
      { name: 'Gulmarg Gondola', area: 'Gulmarg', cost: 1900, why: 'One of the highest cable cars in the world; phase 2 drops you right into snow.', tags: ['snow', 'adventure', 'photos'] },
      { name: 'Dal Lake shikara ride', area: 'Srinagar', cost: 800, why: 'Sunset shikara plus the floating market is non-negotiable.', tags: ['chill', 'photos'] },
      { name: 'Sonamarg', area: 'Ganderbal', cost: 1500, why: 'Thajiwas Glacier day trip, insane meadows, pony rides if you are lazy.', tags: ['adventure', 'snow', 'photos'] },
      { name: 'Pahalgam', area: 'Anantnag', cost: 1600, why: 'Betaab Valley and Aru Valley, river-side chill, very green.', tags: ['chill', 'photos', 'nature'] },
      { name: 'Nishat Bagh', area: 'Srinagar', cost: 50, why: 'Mughal terrace garden with the lake as the backdrop.', tags: ['chill', 'photos', 'budget'] },
      { name: 'Pari Mahal', area: 'Srinagar', cost: 50, why: 'Seven-terrace garden; the city-lights view at sunset is unreal.', tags: ['photos', 'budget'] },
      { name: 'Doodhpathri', area: 'Budgam', cost: 1200, why: 'Less touristy meadow. Quiet, green, perfect picnic spot.', tags: ['offbeat', 'chill', 'nature'] },
    ],
    food: [
      { name: 'Ahdoos', area: 'Residency Road, Srinagar', why: 'Iconic spot for Kashmiri wazwan since forever.', tags: ['nonveg', 'food'] },
      { name: 'Chai Jaai', area: 'Srinagar', why: 'Cute tea room: noon chai, kahwa and bakery stuff.', tags: ['veg', 'cafe', 'budget'] },
    ],
  },
  ooty: {
    name: 'Ooty', area: 'Ooty', origin: 'Bengaluru',
    transport: [
      { mode: 'KSRTC Airavat sleeper bus', detail: 'Bengaluru ⇄ Ooty overnight', cost: 1400, tags: ['budget'] },
      { mode: 'Self-drive SUV (split)', detail: 'Bengaluru → Ooty via Bandipur (that ghat road though)', cost: 2600, tags: ['adventure', 'roadtrip'] },
    ],
    stays: [
      { name: 'Sterling Ooty Fern Hill', area: 'Fern Hill, Ooty', type: 'Resort', perNight: 5200, why: 'Old-school colonial resort, bonfire nights, very cozy.', website: 'https://www.sterlingholidays.com/resorts-hotels/ooty-fern-hill', tags: ['chill'] },
      { name: 'Zostel Ooty', area: 'Ooty', type: 'Hostel private room', perNight: 1500, why: 'Budget-friendly, social, hill views.', website: 'https://www.zostel.com/zostel/ooty/', tags: ['budget', 'social'] },
    ],
    places: [
      { name: 'Nilgiri Mountain Railway', area: 'Ooty', cost: 350, why: 'UNESCO-listed toy train through tunnels and tea estates.', tags: ['photos', 'chill'] },
      { name: 'Pykara Falls', area: 'Ooty', cost: 400, why: 'Waterfall plus boating on Pykara lake, very chill.', tags: ['nature', 'chill'] },
      { name: 'Doddabetta Peak', area: 'Ooty', cost: 100, why: 'Highest point in the Nilgiris; go early for clear views.', tags: ['photos', 'adventure'] },
      { name: 'Avalanche Lake', area: 'Ooty', cost: 900, why: 'Jeep safari into proper untouched forest.', tags: ['adventure', 'offbeat'] },
      { name: 'Government Botanical Garden', area: 'Ooty', cost: 100, why: 'Classic Ooty walk, good for a lazy morning.', tags: ['chill', 'budget'] },
    ],
    food: [
      { name: "Earl's Secret", area: 'Ooty', why: 'Garden café with a heritage-bungalow vibe.', tags: ['cafe', 'veg'] },
      { name: "Nahar's Sidewalk Café", area: 'Charing Cross, Ooty', why: 'Pizzas and hot chocolate; a crowd fav.', tags: ['veg', 'cafe', 'budget'] },
    ],
  },
  goa: {
    name: 'Goa', area: 'North Goa', origin: 'Bengaluru',
    transport: [
      { mode: 'Flight to Goa', detail: 'to MOPA / Dabolim', cost: 5500, tags: ['fast'] },
      { mode: 'Overnight sleeper bus', detail: 'to Mapusa', cost: 1600, tags: ['budget'] },
    ],
    stays: [
      { name: 'The Hosteller Anjuna', area: 'Anjuna, Goa', type: 'Hostel private room', perNight: 2200, why: 'Party-adjacent, social, walking distance to Anjuna.', website: 'https://www.thehosteller.com/', tags: ['party', 'budget', 'social'] },
      { name: 'Villa in Assagao (Airbnb)', area: 'Assagao, Goa', type: 'Private villa with pool', perNight: 9000, why: 'Pool, privacy, near the best cafés.', tags: ['chill', 'luxury'] },
    ],
    places: [
      { name: 'Chapora Fort', area: 'Vagator', cost: 0, why: 'The Dil Chahta Hai fort; go at sunset.', tags: ['photos', 'budget'] },
      { name: 'Anjuna Flea Market', area: 'Anjuna', cost: 0, why: 'Wednesday market: thrift, jewelry, food.', tags: ['shopping', 'chill'] },
      { name: 'Butterfly Beach', area: 'Canacona', cost: 900, why: 'Boat-access-only hidden beach in the south.', tags: ['offbeat', 'nature'] },
      { name: 'Fontainhas', area: 'Panjim', cost: 0, why: 'Latin Quarter: colorful houses, great for photos.', tags: ['photos', 'chill'] },
    ],
    food: [
      { name: "Britto's", area: 'Baga, Goa', why: 'Beach shack classic; seafood and desserts.', tags: ['nonveg', 'food'] },
      { name: 'Gunpowder', area: 'Assagao, Goa', why: 'South-Indian-meets-Goan comfort food in a garden.', tags: ['food', 'veg'] },
    ],
  },
  manali: {
    name: 'Manali', area: 'Manali', origin: 'Delhi',
    transport: [
      { mode: 'HRTC Volvo', detail: 'Delhi ⇄ Manali overnight', cost: 1700, tags: ['budget'] },
      { mode: 'Flight to Bhuntar + cab', detail: '~1h flight + 1.5h cab', cost: 8000, tags: ['fast'] },
    ],
    stays: [
      { name: 'Zostel Manali', area: 'Old Manali', type: 'Hostel private room', perNight: 1500, why: 'Old Manali café belt at your door.', website: 'https://www.zostel.com/zostel/manali/', tags: ['budget', 'social'] },
      { name: 'The Span Resort & Spa', area: 'Kullu-Manali Highway', type: 'Riverside resort', perNight: 12000, why: 'Right on the Beas; the splurge stay.', tags: ['luxury', 'chill'] },
    ],
    places: [
      { name: 'Solang Valley', area: 'Manali', cost: 2500, why: 'Paragliding, snow in winter, ropeway.', tags: ['adventure', 'snow'] },
      { name: 'Atal Tunnel', area: 'Rohtang', cost: 800, why: 'Drive through to Sissu; Lahaul views are wild.', tags: ['roadtrip', 'photos'] },
      { name: 'Jogini Falls', area: 'Vashisht', cost: 0, why: 'Easy, free trek to a waterfall.', tags: ['budget', 'nature', 'adventure'] },
      { name: 'Hadimba Devi Temple', area: 'Manali', cost: 0, why: 'Wooden temple in a cedar forest.', tags: ['chill', 'photos'] },
    ],
    food: [
      { name: 'Café 1947', area: 'Old Manali', why: 'Riverside café with live music nights.', tags: ['cafe', 'party'] },
      { name: "Johnson's Café", area: 'Manali', why: 'Trout and wood-fired stuff; a Manali classic.', tags: ['nonveg', 'food'] },
    ],
  },
};

export const MEETUPS = {
  bengaluru: {
    name: 'Bengaluru',
    venues: [
      { name: 'Toit', area: 'Indiranagar, Bengaluru', kind: 'brewpub', cost: 1400, why: 'The OG brewpub, always buzzing. Book a table on weekends.', tags: ['party', 'food'] },
      { name: 'Church Street Social', area: 'Church Street, Bengaluru', kind: 'cafe-bar', cost: 1100, why: 'Chill work-café by day, loud by night.', tags: ['party', 'chill'] },
      { name: 'Truffles', area: 'Koramangala, Bengaluru', kind: 'burgers', cost: 600, why: 'Cult burger spot, easy on the wallet.', tags: ['food', 'budget'] },
      { name: 'Third Wave Coffee', area: 'Indiranagar, Bengaluru', kind: 'cafe', cost: 450, why: 'Good coffee, you can sit and talk for hours.', website: 'https://www.thirdwavecoffeeroasters.com/', tags: ['chill', 'cafe', 'budget'] },
    ],
    activities: [
      { name: 'Cubbon Park', area: 'Bengaluru', cost: 0, why: 'Morning walk or picnic; the vibes are free.', tags: ['chill', 'budget', 'nature'] },
      { name: 'PVR Orion Mall', area: 'Rajajinagar, Bengaluru', cost: 400, why: 'Movie plus mall plus the lakeside after.', tags: ['movie'] },
      { name: 'Nandi Hills', area: 'Chikkaballapur', cost: 300, why: 'Sunrise ride: the classic Bangalore friends plan.', tags: ['adventure', 'photos'] },
    ],
  },
  delhi: {
    name: 'Delhi',
    venues: [
      { name: 'Big Chill Café', area: 'Khan Market, Delhi', kind: 'cafe', cost: 900, why: 'Huge portions, legendary desserts.', tags: ['food', 'chill'] },
      { name: 'Social', area: 'Hauz Khas Village, Delhi', kind: 'cafe-bar', cost: 1200, why: 'Lake-facing HKV hangout, gets lively at night.', tags: ['party'] },
      { name: 'Paranthe Wali Gali', area: 'Chandni Chowk, Delhi', kind: 'street food', cost: 300, why: 'Old Delhi food crawl, super budget.', tags: ['food', 'budget'] },
    ],
    activities: [
      { name: 'Dilli Haat', area: 'INA, Delhi', cost: 100, why: 'Food from every state plus shopping.', tags: ['food', 'chill', 'budget'] },
      { name: 'Hauz Khas Fort', area: 'Delhi', cost: 0, why: 'Sunset at the lake and ruins.', tags: ['photos', 'chill'] },
      { name: 'Qutub Minar', area: 'Mehrauli, Delhi', cost: 40, why: 'Classic, especially the light show evenings.', tags: ['photos'] },
    ],
  },
  mumbai: {
    name: 'Mumbai',
    venues: [
      { name: 'Leopold Cafe', area: 'Colaba, Mumbai', kind: 'cafe-bar', cost: 900, why: 'Iconic Colaba hangout, always alive.', tags: ['party', 'food'] },
      { name: 'Prithvi Café', area: 'Juhu, Mumbai', kind: 'cafe', cost: 450, why: 'Theatre café; Irish coffee and good convos.', tags: ['chill', 'budget'] },
    ],
    activities: [
      { name: 'Marine Drive', area: 'Mumbai', cost: 0, why: 'Sit on the sea wall at sunset; free and elite.', tags: ['chill', 'budget'] },
      { name: 'Carter Road', area: 'Bandra, Mumbai', cost: 0, why: 'Promenade walk plus food stalls.', tags: ['chill', 'food'] },
    ],
  },
};

export function tripCatalog(dest = '') {
  const k = dest.toLowerCase();
  if (/kashmir|srinagar|gulmarg|pahalgam|sonamarg/.test(k)) return TRIPS.kashmir;
  if (/ooty|uti|ooti|nilgiri/.test(k)) return TRIPS.ooty;
  if (/goa/.test(k)) return TRIPS.goa;
  if (/manali|kullu|himachal/.test(k)) return TRIPS.manali;
  return null;
}

export function meetupCatalog(city = '') {
  const k = city.toLowerCase();
  if (/delhi|gurgaon|gurugram|noida/.test(k)) return MEETUPS.delhi;
  if (/mumbai|bombay|bandra|andheri/.test(k)) return MEETUPS.mumbai;
  return MEETUPS.bengaluru;
}
