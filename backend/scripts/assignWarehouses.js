/**
 * assignWarehouses.js
 * Run: node backend/scripts/assignWarehouses.js
 *
 * Uses Haversine distance to find the geographically closest warehouse
 * for every towing charge that has no warehouse assigned, then updates it.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Pricing  = require("../models/Pricing");

// ── Your 4 warehouses ─────────────────────────────────────────────────────────
const WAREHOUSES = [
  { name: "EZ CARGO",             city: "Old Bridge", state: "NJ", lat: 40.45, lng: -74.32 },
  { name: "SAVANNAH AUTO EXPORT", city: "Savannah",   state: "GA", lat: 32.08, lng: -81.10 },
  { name: "ISHIP",                city: "Houston",    state: "TX", lat: 29.76, lng: -95.37 },
  { name: "CEDARS EXPRESS",       city: "Compton",    state: "CA", lat: 33.90, lng: -118.22 },
];

// ── US state centroids (approximate geographic center, lat/lng) ───────────────
const STATE_CENTROIDS = {
  AL: [32.80, -86.79],  AK: [64.20, -153.43], AZ: [34.05, -111.09], AR: [34.97, -92.37],
  CA: [36.78, -119.42], CO: [39.06, -105.31], CT: [41.60, -72.70],  DE: [38.99, -75.51],
  FL: [27.99, -81.76],  GA: [32.68, -83.44],  HI: [20.80, -156.47], ID: [44.07, -114.74],
  IL: [40.35, -88.99],  IN: [39.85, -86.26],  IA: [42.01, -93.21],  KS: [38.53, -96.73],
  KY: [37.67, -84.87],  LA: [31.17, -91.87],  ME: [44.69, -69.38],  MD: [39.07, -76.80],
  MA: [42.23, -71.53],  MI: [44.32, -85.60],  MN: [46.39, -94.64],  MS: [32.74, -89.67],
  MO: [38.46, -92.29],  MT: [46.88, -110.36], NE: [41.49, -99.90],  NV: [38.31, -117.06],
  NH: [43.45, -71.56],  NJ: [40.30, -74.52],  NM: [34.84, -106.25], NY: [42.17, -74.95],
  NC: [35.63, -79.81],  ND: [47.53, -99.78],  OH: [40.19, -82.67],  OK: [35.56, -96.93],
  OR: [44.57, -122.07], PA: [40.59, -77.21],  RI: [41.68, -71.51],  SC: [33.84, -80.94],
  SD: [44.37, -100.35], TN: [35.86, -86.35],  TX: [31.17, -99.33],  UT: [39.32, -111.09],
  VT: [44.05, -72.71],  VA: [37.77, -78.17],  WA: [47.40, -121.49], WV: [38.49, -80.95],
  WI: [44.27, -89.62],  WY: [42.96, -107.55],
};

// ── Haversine distance in miles ───────────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 3958.8; // Earth radius in miles
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dG = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dL / 2) ** 2 +
             Math.cos(lat1 * Math.PI / 180) *
             Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Find nearest warehouse for a given state code ─────────────────────────────
function nearestWarehouse(stateCode) {
  const coords = STATE_CENTROIDS[(stateCode || "").toUpperCase().trim()];
  if (!coords) return null;
  const [lat, lng] = coords;
  let best = null, bestDist = Infinity;
  for (const wh of WAREHOUSES) {
    const d = haversine(lat, lng, wh.lat, wh.lng);
    if (d < bestDist) { bestDist = d; best = wh; }
  }
  return best ? { ...best, miles: Math.round(bestDist) } : null;
}

// ── Print state→warehouse table for verification ──────────────────────────────
function printTable() {
  console.log("\nState → Nearest Warehouse");
  console.log("─".repeat(55));
  const states = Object.keys(STATE_CENTROIDS).sort();
  for (const state of states) {
    const wh = nearestWarehouse(state);
    if (wh) console.log(`  ${state.padEnd(4)} → ${wh.name.padEnd(24)} (${wh.city}, ${wh.state} — ${wh.miles} mi)`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  printTable();

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("\nMongoDB connected");

  const rows = await Pricing.find({
    type: "towing",
    $or: [{ warehouse: "" }, { warehouse: null }, { warehouse: { $exists: false } }],
  }).select("name city state warehouse");

  console.log(`\nUpdating ${rows.length} towing charges with no warehouse...\n`);

  let updated = 0, skipped = 0;

  for (const row of rows) {
    const wh = nearestWarehouse(row.state);
    if (!wh) {
      console.log(`  ✗ SKIP  ${(row.name || row.city || "?").substring(0, 45).padEnd(45)}  state="${row.state}" — not recognized`);
      skipped++;
      continue;
    }
    await Pricing.findByIdAndUpdate(row._id, { $set: { warehouse: wh.name } });
    console.log(`  ✓ ${(row.name || row.city || "?").substring(0, 45).padEnd(45)}  ${(row.state || "??").padEnd(3)} → ${wh.name}`);
    updated++;
  }

  console.log(`\n── Summary ───────────────────────────────────────`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}`);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
