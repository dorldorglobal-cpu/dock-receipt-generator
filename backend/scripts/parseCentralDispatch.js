/**
 * parseCentralDispatch.js
 * Run: node backend/scripts/parseCentralDispatch.js
 *
 * Parses Central Dispatch copy-paste data, groups by origin route,
 * computes median cost, and updates Pricing records.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs      = require("fs");
const path    = require("path");
const mongoose = require("mongoose");
const Pricing  = require("../models/Pricing");

const DRY_RUN = process.argv.includes("--dry");

// ── Parse the pasted text ─────────────────────────────────────────────────────
const raw = fs.readFileSync(path.join(__dirname, "cd_paste.txt"), "utf8");

// Split into blocks — each starts with a dispatch number line
const blocks = raw.split(/\n(?=\d{4,5}[\/\-][a-z0-9]+)/i).filter(b => b.trim());

function parseBlock(block) {
  const lines = block.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  if (!lines.length) return null;

  // Dispatch number (first line)
  const numMatch = lines[0].match(/^(\d+)/);
  if (!numMatch) return null;
  const dispatchNum = lines[0];

  // Load cost — look for "$NNN" line immediately after "Load Info"
  let cost = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "Load Info") {
      const m = lines[i + 1]?.match(/^\$(\d+)$/);
      if (m) cost = parseInt(m[1]);
      break;
    }
  }
  if (!cost) return null;

  // Origin block
  let originName = null, originAddr = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "Origin") {
      originName = lines[i + 1];
      originAddr = lines[i + 2];
      break;
    }
  }
  if (!originName) return null;

  // Destination block
  let destName = null;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Destination")) {
      let j = i + 1;
      if (lines[j]?.match(/^\(\d+ miles?\)/i)) j++;
      destName = lines[j];
      break;
    }
  }
  if (!destName) return null;

  return { dispatchNum, cost, originName, originAddr, destName };
}

// ── Identify auction company from origin text ─────────────────────────────────
function parseOrigin(originName, originAddr) {
  // Get state/city from address line "ST: City, zip"
  let city = null, state = null;
  if (originAddr) {
    const m = originAddr.match(/^([A-Z]{2}):\s*(.+?),\s*\d+/i);
    if (m) {
      state = m[1].toUpperCase();
      city  = m[2].trim().toUpperCase()
        .replace(/^FT\.?\s+/, "FORT ")   // normalize FT → FORT
        .replace(/^MT\.?\s+/, "MOUNT "); // normalize MT → MOUNT
    }
  }

  // Fallback: try parsing state from origin name "CITY, ST - COMPANY"
  if (!state || !city) {
    const m = originName.match(/,\s*([A-Z]{2})\s*[-–]/i);
    if (m) state = m[1].toUpperCase();
    const m2 = originName.match(/^(.+?),\s*[A-Z]{2}/i);
    if (m2 && !city) city = m2[1].replace(/COPART|I\.A\.A\.I\.|IAAI|IAA/gi, "").replace(/[-\s]+$/, "").trim().toUpperCase();
  }

  const n = originName.toUpperCase();
  let company = null;
  if (/COPART/i.test(n))                              company = "COPART";
  else if (/I\.A\.A\.I\.|IAAI|IAA|I\.A\.A\.I/i.test(n)) company = "IAAI";

  return { city, state, company };
}

// ── Identify destination type ─────────────────────────────────────────────────
function parseDestination(destName) {
  const d = destName.toUpperCase();

  // Warehouses
  if (/CEDARS.?EXPRESS/i.test(d))       return { type: "warehouse", name: "CEDARS EXPRESS" };
  if (/EZ.?CARGO|EZCARGO/i.test(d))    return { type: "warehouse", name: "EZ CARGO" };
  if (/SAVANNAH.?AUTO|SAVANNAH/i.test(d)) return { type: "warehouse", name: "SAVANNAH AUTO EXPORT" };
  if (/\bISHIP\b/i.test(d))            return { type: "warehouse", name: "ISHIP" };

  // Ports
  if (/PROVIDENCE/i.test(d))           return { type: "port", name: "PROVIDENCE" };
  if (/BALT|DUNDALK|TARTAN/i.test(d)) return { type: "port", name: "BALTIMORE" };
  if (/DELAWARE|WILMINGTON/i.test(d) && !/COPART/i.test(d)) return { type: "port", name: "WILMINGTON" };
  if (/FREEPORT/i.test(d))             return { type: "port", name: "FREEPORT" };
  if (/\bJAX\b|JACKSONVILLE/i.test(d) && !/COPART|ALTON|PECAN/i.test(d)) return { type: "port", name: "JACKSONVILLE" };

  return { type: "skip", name: destName };
}

// ── Max helper ────────────────────────────────────────────────────────────────
function maxCost(arr) {
  return Math.max(...arr);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // ── Parse all blocks ───────────────────────────────────────────────────────
  const entries = blocks.map(parseBlock).filter(Boolean);
  console.log(`Parsed ${entries.length} dispatch entries from paste\n`);

  // ── Skip non-auction origins (ZONE PORT SERVICES, A TO Z, warehouse origns) ─
  const SKIP_ORIGINS = /ZONE PORT|A TO Z|SAVANNAH AUTO|CEDARS EXPRESS|EZ.?CARGO|ISHIP/i;

  // ── Build route map: city|state|company|destType → [costs] ────────────────
  const routeMap = new Map();
  let skipped = 0;

  for (const e of entries) {
    const { city, state, company } = parseOrigin(e.originName, e.originAddr);
    const dest = parseDestination(e.destName);

    if (dest.type === "skip") { skipped++; continue; }
    if (SKIP_ORIGINS.test(e.originName)) { skipped++; continue; }
    if (!city || !state || !company) { skipped++; continue; }

    const key = `${city}|${state}|${company}|${dest.type}|${dest.name}`;
    if (!routeMap.has(key)) routeMap.set(key, { city, state, company, destType: dest.type, destName: dest.name, costs: [] });
    routeMap.get(key).costs.push(e.cost);
  }

  console.log(`Unique routes found: ${routeMap.size}  (${skipped} entries skipped)\n`);

  // ── Connect to DB ──────────────────────────────────────────────────────────
  await mongoose.connect(process.env.MONGODB_URI);

  let updated = 0, notFound = 0, alreadySet = 0;
  const notFoundList = [];

  for (const [key, route] of routeMap) {
    const med = maxCost(route.costs);
    const { city, state, company, destType, destName } = route;

    // Find matching Pricing record
    // Match: type=towing, city~=city, state~=state, name contains COPART or IAAI
    const companyRegex = company === "COPART" ? /COPART/i : /I\.A\.A\.I\.?|IAAI|IAA/i;

    const candidates = await Pricing.find({
      type: "towing",
      city:  { $regex: `^${city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,  $options: "i" },
      state: { $regex: `^${state.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });

    const record = candidates.find(r => companyRegex.test(r.name || ""));

    if (!record) {
      notFoundList.push(`  ✗ ${company.padEnd(6)} ${city}, ${state} → ${destType.padEnd(9)} ${destName}  [costs: ${route.costs.join(", ")} → median $${med}]`);
      notFound++;
      continue;
    }

    // Determine which cost field to update
    const field = destType === "port" ? "cost" : "warehouseCost";
    const current = record[field];

    // Skip only if current value is already >= the new max
    if (current >= med) {
      console.log(`  ~ SKIP  ${record.name.substring(0,45).padEnd(45)} ${field}=${current} (already at max)`);
      alreadySet++;
      continue;
    }

    if (!DRY_RUN) {
      await Pricing.findByIdAndUpdate(record._id, { $set: { [field]: med } });
    }

    const arrow = current > 0 ? ` (was $${current})` : "";
    console.log(`  ✓ ${DRY_RUN ? "DRY" : "UPD"} ${record.name.substring(0,42).padEnd(42)} ${field}=$${med}${arrow}  [from: ${route.costs.join(", ")}]`);
    updated++;
  }

  console.log("\n── NOT FOUND in DB ───────────────────────────────────────────────────────");
  notFoundList.forEach(l => console.log(l));

  console.log(`\n── Summary ──────────────────────────────────────────────────────────────`);
  console.log(`  Updated  : ${updated}`);
  console.log(`  Already set: ${alreadySet}`);
  console.log(`  Not found: ${notFound}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
