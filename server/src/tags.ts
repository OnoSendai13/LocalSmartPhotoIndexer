/**
 * Tag validation and normalization for server-side photo processing.
 * Ported from types.ts for use in the Node.js backend.
 */

// Allowed tags by category
export const ALLOWED_TAGS = {
  people: [
    "Portrait", "Group", "Family", "Couple", "Selfie", "People",
  ],
  animals: [
    "Dog", "Cat", "Bird", "Horse", "Animal", "Wildlife",
    "Lion", "Elephant", "Giraffe", "Zebra", "Monkey",
    "Fish", "Insect",
  ],
  scene: [
    "Landscape", "Cityscape", "Beach", "Mountain", "Forest",
    "Garden", "Park", "Street", "Village", "Countryside",
    "Desert", "Lake", "River", "Ocean", "Savanna", "Grassland",
    "Panorama",
  ],
  location: [
    "Indoor", "Outdoor", "Home", "Restaurant", "Museum",
    "Church", "Castle", "Building", "Market", "Shop",
    "Hotel", "Airport", "Station", "School", "Office",
  ],
  weather: [
    "Sunny", "Cloudy", "Sunset", "Sunrise", "Night",
    "Rainy", "Snowy",
  ],
  activities: [
    "Walking", "Posing", "Eating", "Traveling", "Sports",
    "Swimming", "Hiking", "Vacation", "Shopping", "Working",
    "Playing", "Dancing", "Resting", "Running", "Cycling",
    "Safari", "Wedding", "Celebration",
  ],
  objects: [
    "Car", "Food", "Flower", "Architecture", "Art",
    "Statue", "Tree", "Water", "Boat", "Plane",
    "Train", "Jewelry", "Clothing", "Book", "Monument",
  ],
  style: [
    "Portrait", "Artistic", "Panorama", "Macro",
    "Black-White", "Golden-Hour", "Night-Shot",
  ],
};

// Flatten all allowed tags into a single array
export const ALL_ALLOWED_TAGS: string[] = Object.values(ALLOWED_TAGS).flat();

// Create a Set for fast lookup
export const ALLOWED_TAGS_SET = new Set(ALL_ALLOWED_TAGS);

// Words to exclude (LLM reasoning residuals, common non-descriptive words)
const EXCLUDED_WORDS = new Set([
  "could", "seems", "here", "there", "this", "that", "the", "and", "with",
  "appears", "looks", "like", "maybe", "probably", "possibly", "might",
  "showing", "shows", "contains", "has", "have", "featuring", "features",
  "image", "photo", "picture", "scene", "visible", "seen", "can", "see",
  "very", "quite", "really", "just", "also", "some", "many", "few",
  "good", "nice", "beautiful", "amazing", "great", "wonderful",
  "male", "female", "model", "person", "thing", "object", "place",
  "daytime", "daylight", "today", "now", "then",
  "sunbathing", "condition", "tattoo",
]);

// Synonym mapping to allowed tags
const TAG_SYNONYMS: Record<string, string> = {
  // Wildlife
  "lioness": "Lion", "lions": "Lion",
  "elephants": "Elephant",
  "giraffes": "Giraffe",
  "zebras": "Zebra",
  "monkeys": "Monkey",
  "ape": "Monkey", "apes": "Monkey",
  "birds": "Bird",
  "dogs": "Dog", "cats": "Cat", "horses": "Horse",
  "fishes": "Fish", "insects": "Insect",
  "bug": "Insect", "bugs": "Insect",
  "butterfly": "Insect",

  // Scene
  "mountains": "Mountain",
  "forests": "Forest",
  "beaches": "Beach",
  "lakes": "Lake", "rivers": "River",
  "sea": "Ocean", "seas": "Ocean",
  "desert": "Desert", "deserts": "Desert",
  "plains": "Savanna",
  "prairie": "Grassland", "meadow": "Grassland",

  // Location
  "markets": "Market",
  "store": "Shop", "stores": "Shop", "shops": "Shop",
  "mall": "Shop",
  "cathedral": "Church", "temple": "Church", "mosque": "Church",
  "palace": "Castle", "chateau": "Castle", "fortress": "Castle",

  // Activity
  "walk": "Walking",
  "hike": "Hiking",
  "swim": "Swimming",
  "run": "Running",
  "cycle": "Cycling", "bike": "Cycling", "biking": "Cycling",
  "dance": "Dancing",
  "rest": "Resting", "sleep": "Resting", "relax": "Resting", "relaxing": "Resting",
  "shop": "Shopping", "buy": "Shopping", "buying": "Shopping",
  "purchasing": "Shopping", "selling": "Shopping",
  "work": "Working",
  "play": "Playing", "game": "Playing",
  "celebrate": "Celebration", "celebrating": "Celebration",
  "party": "Celebration", "birthday": "Celebration", "christmas": "Celebration",
  "holiday": "Vacation", "holidays": "Vacation",
  "trip": "Traveling", "journey": "Traveling", "tour": "Traveling", "travel": "Traveling",

  // People
  "child": "Family", "children": "Family",
  "kids": "Family", "kid": "Family",
  "baby": "Family", "babies": "Family",
  "man": "People", "men": "People",
  "woman": "People", "women": "People",
  "crowd": "Group", "team": "Group", "friends": "Group",

  // Weather
  "sun": "Sunny", "sunshine": "Sunny",
  "cloud": "Cloudy", "clouds": "Cloudy", "overcast": "Cloudy",
  "rain": "Rainy", "raining": "Rainy", "storm": "Rainy",
  "snow": "Snowy", "snowing": "Snowy", "winter": "Snowy",
  "dawn": "Sunrise",
  "dusk": "Sunset", "evening": "Sunset",
  "golden-hour": "Golden-Hour", "goldenhour": "Golden-Hour", "golden hour": "Golden-Hour",

  // Style
  "artistic": "Artistic", "art": "Art",
  "bw": "Black-White", "blackwhite": "Black-White", "monochrome": "Black-White",

  // Objects
  "vehicle": "Car", "automobile": "Car",
  "ship": "Boat", "yacht": "Boat",
  "aircraft": "Plane", "airplane": "Plane",
  "railway": "Train", "locomotive": "Train",
  "flowers": "Flower",
  "plant": "Flower", "plants": "Flower",
  "trees": "Tree",
  "building": "Architecture", "buildings": "Architecture",
  "house": "Architecture", "houses": "Architecture",
  "sculpture": "Statue", "sculptures": "Statue", "statues": "Statue",
  "ring": "Jewelry", "necklace": "Jewelry", "bracelet": "Jewelry",
  "clothes": "Clothing", "dress": "Clothing", "suit": "Clothing",
  "basket": "Objects", "baskets": "Objects", "container": "Objects",
};

/**
 * Find the closest valid tag for a given input string.
 * Returns null if the input doesn't match any allowed tag.
 */
export function findClosestTag(input: string): string | null {
  const normalized = input.toLowerCase().trim();

  // Check if it's an excluded word
  if (EXCLUDED_WORDS.has(normalized)) {
    return null;
  }

  // Check synonyms first
  if (TAG_SYNONYMS[normalized]) {
    return TAG_SYNONYMS[normalized];
  }

  // Direct match (case-insensitive)
  for (const tag of ALL_ALLOWED_TAGS) {
    if (tag.toLowerCase() === normalized) {
      return tag;
    }
  }

  // Check if normalized matches with hyphen removed
  const withoutHyphen = normalized.replace(/-/g, '');
  for (const tag of ALL_ALLOWED_TAGS) {
    if (tag.toLowerCase().replace(/-/g, '') === withoutHyphen) {
      return tag;
    }
  }

  // Partial match (tag contains input or input contains tag)
  for (const tag of ALL_ALLOWED_TAGS) {
    const tagLower = tag.toLowerCase();
    if (tagLower.includes(normalized) || normalized.includes(tagLower)) {
      if (normalized.length >= 3 && tagLower.length >= 3) {
        return tag;
      }
    }
  }

  return null;
}

/**
 * Validate and normalize an array of raw tags from the LLM.
 * Filters out invalid tags, deduplicates, and returns valid ones.
 */
export function validateTags(rawTags: string[]): string[] {
  const validTags: string[] = [];

  for (const tag of rawTags) {
    const validTag = findClosestTag(String(tag).trim());
    if (validTag && !validTags.includes(validTag)) {
      validTags.push(validTag);
    }
  }

  return validTags.slice(0, 8); // Limit to 8 tags max
}

/**
 * Check if a tag is allowed.
 */
export function isValidTag(tag: string): boolean {
  return ALLOWED_TAGS_SET.has(tag);
}
