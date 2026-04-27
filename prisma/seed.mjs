import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

const seeds = [
  {
    title: "The Steam Tunnels Before Finals",
    loreBlurb:
      "Engineering students have whispered about the maintenance steam tunnels since the 80s.",
    description:
      "A campus myth turned tradition: small groups navigate the steam tunnel network between the old power plant and the student union—allegedly—during reading week. Lore says someone left chalk arrows that reappear every year.",
    steps: [
      "Enter only if your campus maps show legal maintenance access or public passages.",
      "Go with a group; tell someone outside where you are.",
      "Follow marked maintenance corridors only—do not force doors.",
    ],
    locationName: "Central Campus utilities (example)",
    lat: 37.8716,
    lng: -122.2588,
    difficulty: 3,
    safetyScore: 4,
    warnings: ["restricted_or_unclear_access", "physical", "night_common"],
    category: "tradition",
  },
  {
    title: "Midnight Bell, Wrong Tower",
    loreBlurb: "Only one bell is supposed to ring at midnight on charter day—but two sometimes answer.",
    description:
      "Student newspaper archives mention a prank turned ritual: listeners gather on the quad to compare bell harmonics. The 'wrong' partial is said to predict a mild winter.",
    steps: [
      "Check public event listings for charter day timing.",
      "Stay on public walkways; respect quiet hours elsewhere.",
    ],
    locationName: "Main Quad",
    lat: 37.872,
    lng: -122.2595,
    difficulty: 1,
    safetyScore: 1,
    warnings: [],
    category: "history",
  },
  {
    title: "Rooftop Garden That Is Not on the Map",
    loreBlurb: "Environmental club supposedly tends a container garden three stories up.",
    description:
      "Forum posts describe a tucked-away stairwell leading to a rooftop with planters and a painted compass rose. Access may be limited to building residents or staff.",
    steps: [
      "Verify whether the roof deck is a permitted amenity before visiting.",
      "Never climb exterior fire escapes or bypass locks.",
    ],
    locationName: "Arts building (illustrative)",
    lat: 37.87,
    lng: -122.26,
    difficulty: 2,
    safetyScore: 4,
    warnings: ["height", "restricted_or_unclear_access"],
    category: "urban_exploration",
  },
  {
    title: "The Tunnel Between Libraries",
    loreBlurb: "Two brutalist stacks share a book conveyor—and maybe a walkable service corridor.",
    description:
      "A slice of campus infrastructure lore: deliveries and routing robots use underground links. Some passages are staff-only; the quest is learning which parts have public tours.",
    steps: [
      "Ask library staff about official tours or exhibits in the stacks.",
      "Photograph only where photography is allowed.",
    ],
    locationName: "North & South Library link",
    lat: 37.873,
    lng: -122.257,
    difficulty: 2,
    safetyScore: 2,
    warnings: ["restricted_or_unclear_access"],
    category: "history",
  },
  {
    title: "Coffee Crawl: Five Independent Shops, One Night",
    loreBlurb: "A social endurance challenge born on a subreddit for insomniac grad students.",
    description:
      "Hit five independent cafes between dusk and dawn, walking only—no rideshare. Order something small at each; tip well. The 'quest' is the conversation and the city at odd hours.",
    steps: [
      "Map five shops with late hours; check closing times.",
      "Stay in well-lit areas; go with friends.",
    ],
    locationName: "Downtown (example)",
    lat: 37.87,
    lng: -122.27,
    difficulty: 2,
    safetyScore: 2,
    warnings: ["night_common"],
    category: "social",
  },
  {
    title: "Find the Bronze Mouse",
    loreBlurb: "Sculpture hunt: a mouse the size of a shoe hides in plain sight near STEM quad.",
    description:
      "Campus tour guides sometimes omit it. Alumni threads claim rubbing the nose before exams is good luck—unofficially.",
    steps: [
      "Start at the STEM quad fountain; search pedestals and planters.",
      "Take a photo from a respectful distance; do not climb sculptures.",
    ],
    locationName: "STEM Quad",
    lat: 37.8725,
    lng: -122.258,
    difficulty: 1,
    safetyScore: 1,
    warnings: [],
    category: "challenge",
  },
  {
    title: "First Rain: The Unofficial Parade",
    loreBlurb: "When the first real storm hits, some dorms empty onto the muddiest field—by tradition, not schedule.",
    description:
      "A messy, joyful social sprint: slip-and-slide energy without the corporate sponsor. Campus facilities sometimes close fields afterward—check policies.",
    steps: [
      "Watch weather; join only if you accept getting soaked.",
      "No glass, no stakes in the ground, leave the field cleaner than you found it.",
    ],
    locationName: "Intramural field",
    lat: 37.871,
    lng: -122.261,
    difficulty: 2,
    safetyScore: 2,
    warnings: ["physical"],
    category: "social",
  },
  {
    title: "Ghost Sign on Brick",
    loreBlurb: "Faded painted ads under newer paint—visible only at certain angles after rain.",
    description:
      "Urban history micro-quest: walk the alley behind the old theater district and catch ghost lettering when wet brick darkens unevenly.",
    steps: [
      "Walk the public alley; do not enter private loading docks.",
      "Best after light rain; mind traffic at alley mouths.",
    ],
    locationName: "Old Theater Alley",
    lat: 37.869,
    lng: -122.268,
    difficulty: 1,
    safetyScore: 1,
    warnings: ["night_common"],
    category: "history",
  },
  {
    title: "Stairwell Acoustics: The Whispering Landing",
    loreBlurb: "Between floors 3 and 4, a wedge shape carries whispers strangely—physics club demo spot.",
    description:
      "A low-risk 'secret' that is really architecture: stand on opposite sides of the wedge landing and speak softly.",
    steps: [
      "Use a public academic building stairwell during open hours.",
      "Keep volume low; yield to foot traffic.",
    ],
    locationName: "Science Hall stair B",
    lat: 37.8735,
    lng: -122.259,
    difficulty: 1,
    safetyScore: 1,
    warnings: [],
    category: "challenge",
  },
  {
    title: "Lantern Float (Permit-Only Variant)",
    loreBlurb: "Some cultures float lanterns on water for remembrance—this campus version uses LED floats in the reflecting pool during approved events only.",
    description:
      "Do not use open flame on campus. The lore-safe version: join a registered cultural org event with LED floats and stewarded cleanup.",
    steps: [
      "Find a registered event; RSVP if required.",
      "Participate only in the stewarded zone; pack out trash.",
    ],
    locationName: "Reflecting pool",
    lat: 37.8718,
    lng: -122.2592,
    difficulty: 1,
    safetyScore: 1,
    warnings: [],
    category: "tradition",
  },
  {
    title: "The Tree With Three Trunks",
    loreBlurb: "Arborists grafted survivors together after a storm—now it's a meeting pin for night hikes.",
    description:
      "Easy landmark on the fire road loop. Groups use it as a rally point before moonlit ridge walks on permitted trails.",
    steps: [
      "Stay on marked trails; carry lights.",
      "Check park/campus hours and closures.",
    ],
    locationName: "Fire road loop trailhead",
    lat: 37.875,
    lng: -122.255,
    difficulty: 2,
    safetyScore: 2,
    warnings: ["night_common", "physical"],
    category: "urban_exploration",
  },
  {
    title: "Free Food Radar: Club Fair Circuit",
    loreBlurb: "Speedrun ethical samples during welcome week—maps circulate on Discord.",
    description:
      "Social quest: collect club flyers, try vegetarian samples, meet three orgs you'd never pick from a brochure alone.",
    steps: [
      "Check the official fair map for times.",
      "Be polite at booths; no hoarding.",
    ],
    locationName: "Student union plaza",
    lat: 37.8722,
    lng: -122.2585,
    difficulty: 1,
    safetyScore: 1,
    warnings: [],
    category: "social",
  },
];

async function main() {
  for (const q of seeds) {
    const slug = slugify(q.title);
    await prisma.quest.upsert({
      where: { slug },
      create: {
        slug,
        title: q.title,
        loreBlurb: q.loreBlurb,
        description: q.description,
        steps: JSON.stringify(q.steps),
        locationName: q.locationName,
        lat: q.lat,
        lng: q.lng,
        difficulty: q.difficulty,
        safetyScore: q.safetyScore,
        warnings: JSON.stringify(q.warnings),
        category: q.category,
        status: "published",
        confidence: 1,
      },
      update: {},
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
