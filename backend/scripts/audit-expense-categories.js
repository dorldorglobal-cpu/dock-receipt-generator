require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Expense  = require("../models/Expense");

const CATEGORIES = Expense.CATEGORIES;

// Mirrors frontend/src/pages/Expenses.jsx autoCategoryFromVendor — kept in sync manually.
function autoCategoryFromVendor(vendor) {
  const v = (vendor || "").toLowerCase();
  if (/e-?z\s*cargo|savannah|i-?ship|cedars/.test(v))                          return "Loaders & Warehouses";
  if (/sallaum|acl\b|grimaldi|wallenius|eukor/.test(v))                        return "Ocean Freight";
  if (/copart|\biaa\b|iaai|manheim|adesa/.test(v))                             return "Storage";
  if (/central dispatch|chatgpt|claude|openai|anthropic/.test(v))              return "Software";
  if (/fedex|ups\b|usps|dhl/.test(v))                                         return "Mailing Fees";
  if (/neva\s*28|mtv trucking|hey logistics|lj logistics|\bfts\b|\bamf\b|ll trans|arc trucking|vs transit|victory towing|golden carrier|\bsdm\b|vikstatus|\b4rg\b|b strong|ponce|dispatch|tow|transport/.test(v)) return "Towing / Transport";
  return "";
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("Connected\n");

  const all = await Expense.find({}).select("_id vendor category taxCategory amount date orderRef description").lean();
  console.log(`Total expenses: ${all.length}\n`);

  // 1. Missing / invalid category (not in the schema enum)
  const invalid = all.filter(e => !e.category || !CATEGORIES.includes(e.category));
  console.log(`=== Missing/invalid category: ${invalid.length} ===`);
  for (const e of invalid) {
    console.log(`  [${e._id}]  vendor="${e.vendor || ""}"  category="${e.category || ""}"  $${e.amount}  Order #${e.orderRef || "-"}  desc="${(e.description||"").slice(0,60)}"`);
  }

  // 2. Missing/blank taxCategory (any category)
  const blankTax = all.filter(e => !e.taxCategory);
  console.log(`\n=== Blank taxCategory: ${blankTax.length} ===`);
  const blankTaxByCat = {};
  for (const e of blankTax) blankTaxByCat[e.category || "(none)"] = (blankTaxByCat[e.category || "(none)"] || 0) + 1;
  for (const [cat, n] of Object.entries(blankTaxByCat)) console.log(`  ${cat}: ${n}`);

  // 3. Vendor-name heuristic mismatches (report only — vendor regexes are broad/soft guesses,
  //    not applied automatically here to avoid overwriting legitimate exceptions)
  const mismatches = [];
  for (const e of all) {
    const guessed = autoCategoryFromVendor(e.vendor);
    if (guessed && e.category && guessed !== e.category) {
      mismatches.push({ ...e, guessed });
    }
  }
  console.log(`\n=== Vendor/category heuristic mismatches: ${mismatches.length} ===`);
  const grouped = {};
  for (const m of mismatches) {
    const key = `${(m.vendor||"").trim()} | current="${m.category}" -> guessed="${m.guessed}"`;
    grouped[key] = (grouped[key] || 0) + 1;
  }
  for (const [key, n] of Object.entries(grouped).sort((a,b) => b[1]-a[1])) {
    console.log(`  ${n}x  ${key}`);
  }

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
