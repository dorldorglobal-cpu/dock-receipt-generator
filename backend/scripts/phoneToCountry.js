/**
 * phoneToCountry.js
 * Run: node backend/scripts/phoneToCountry.js
 *
 * Scans all AddressBook entries that have no country set.
 * Detects the country from the phone number's country code and fills it in.
 * Only updates entries where country is blank/missing — never overwrites.
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose   = require("mongoose");
const AddressBook = require("../models/AddressBook");

// ── Country-code → Country name map ──────────────────────────────────────────
// Ordered longest prefix first so '234' is tried before '23', '2', etc.
// minTotal = minimum total digit count (country code + subscriber number)
// to avoid false matches on short numbers or US area codes (e.g. US 234-xxx-xxxx = 10 digits)
const CC_MAP = [
  // ── West Africa ───────────────────────────────────────────────────────────
  { prefix: "234", country: "Nigeria",           minTotal: 13 }, // +234 8xx/7xx/9xx = 13 digits
  { prefix: "233", country: "Ghana",             minTotal: 12 }, // +233 2x/5x = 12 digits
  { prefix: "229", country: "Benin",             minTotal: 11 }, // +229 XX XX XX XX
  { prefix: "228", country: "Togo",              minTotal: 11 }, // +228 XX XX XX XX
  { prefix: "221", country: "Senegal",           minTotal: 11 },
  { prefix: "225", country: "Ivory Coast",       minTotal: 11 },
  { prefix: "226", country: "Burkina Faso",      minTotal: 11 },
  { prefix: "227", country: "Niger",             minTotal: 11 },
  { prefix: "223", country: "Mali",              minTotal: 11 },
  { prefix: "224", country: "Guinea",            minTotal: 11 },
  { prefix: "231", country: "Liberia",           minTotal: 11 },
  { prefix: "232", country: "Sierra Leone",      minTotal: 11 },
  { prefix: "237", country: "Cameroon",          minTotal: 11 },
  { prefix: "220", country: "Gambia",            minTotal: 11 },
  { prefix: "240", country: "Equatorial Guinea", minTotal: 11 },
  { prefix: "241", country: "Gabon",             minTotal: 11 },
  { prefix: "243", country: "DR Congo",          minTotal: 11 },
  { prefix: "244", country: "Angola",            minTotal: 11 },
  { prefix: "245", country: "Guinea-Bissau",     minTotal: 11 },
  { prefix: "248", country: "Seychelles",        minTotal: 11 },
  { prefix: "249", country: "Sudan",             minTotal: 11 },
  { prefix: "251", country: "Ethiopia",          minTotal: 11 },
  { prefix: "252", country: "Somalia",           minTotal: 11 },
  { prefix: "253", country: "Djibouti",          minTotal: 11 },
  { prefix: "255", country: "Tanzania",          minTotal: 12 },
  { prefix: "256", country: "Uganda",            minTotal: 12 },
  { prefix: "257", country: "Burundi",           minTotal: 11 },
  { prefix: "258", country: "Mozambique",        minTotal: 11 },
  { prefix: "260", country: "Zambia",            minTotal: 12 },
  { prefix: "261", country: "Madagascar",        minTotal: 11 },
  { prefix: "263", country: "Zimbabwe",          minTotal: 12 },
  { prefix: "264", country: "Namibia",           minTotal: 12 },
  { prefix: "265", country: "Malawi",            minTotal: 12 },
  { prefix: "266", country: "Lesotho",           minTotal: 11 },
  { prefix: "267", country: "Botswana",          minTotal: 11 },
  { prefix: "268", country: "Swaziland",         minTotal: 11 },
  // ── North Africa / Middle East ────────────────────────────────────────────
  { prefix: "212", country: "Morocco",           minTotal: 12 },
  { prefix: "213", country: "Algeria",           minTotal: 12 },
  { prefix: "216", country: "Tunisia",           minTotal: 11 },
  { prefix: "218", country: "Libya",             minTotal: 12 },
  { prefix: "20",  country: "Egypt",             minTotal: 12 },
  { prefix: "966", country: "Saudi Arabia",      minTotal: 12 },
  { prefix: "971", country: "UAE",               minTotal: 12 },
  // ── Europe ────────────────────────────────────────────────────────────────
  { prefix: "44",  country: "United Kingdom",    minTotal: 12 }, // +44 7xxx = 12 digits
  { prefix: "49",  country: "Germany",           minTotal: 11 },
  { prefix: "33",  country: "France",            minTotal: 11 },
  { prefix: "31",  country: "Netherlands",       minTotal: 11 },
  { prefix: "32",  country: "Belgium",           minTotal: 11 },
  // ── Americas ─────────────────────────────────────────────────────────────
  { prefix: "1",   country: "United States",     minTotal: 11 }, // +1 = 11 digits
];

function detectCountry(phone) {
  if (!phone) return null;

  // Strip all non-digit characters (spaces, dashes, parens, dots, +)
  const digits = phone.replace(/\D/g, "");

  if (digits.length < 7) return null; // too short to be meaningful

  for (const { prefix, country, minTotal } of CC_MAP) {
    if (digits.startsWith(prefix) && digits.length >= minTotal) {
      return country;
    }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("MongoDB connected\n");

  // Find all entries with a phone but no country (or empty country)
  const entries = await AddressBook.find({
    phone:   { $exists: true, $ne: "" },
    $or: [{ country: { $exists: false } }, { country: "" }, { country: null }],
  });

  console.log(`Found ${entries.length} entries with phone but no country\n`);

  let updated = 0;
  let noMatch = 0;

  for (const entry of entries) {
    const country = detectCountry(entry.phone);
    if (country) {
      await AddressBook.findByIdAndUpdate(entry._id, { $set: { country } });
      console.log(`  ✓ ${(entry.companyName || entry.contactName || "?").padEnd(45)} ${entry.phone.padEnd(20)} → ${country}`);
      updated++;
    } else {
      console.log(`  · ${(entry.companyName || entry.contactName || "?").padEnd(45)} ${entry.phone.padEnd(20)}   (no match)`);
      noMatch++;
    }
  }

  console.log(`\n── Summary ─────────────────────────────────────`);
  console.log(`  Updated : ${updated}`);
  console.log(`  No match: ${noMatch}`);
  console.log(`  Total   : ${entries.length}`);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
