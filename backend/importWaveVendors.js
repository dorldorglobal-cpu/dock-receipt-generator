// importWaveVendors.js  —  run once: node importWaveVendors.js
// Reads wave_vendors.txt and bulk-imports into MongoDB vendors collection

require("dotenv").config();
const mongoose = require("mongoose");
const fs       = require("fs");
const path     = require("path");
const Vendor   = require("./models/Vendor");

// ── Wave paste parser ────────────────────────────────────────────────────────
// Handles both tab-separated (browser copy) and newline-separated formats
function parseWavePaste(text) {
  // Wave copies as a tab-separated table: "Vendor\tCompany Name"
  // Normalise to one token per line so the block parser works
  const normalised = text.replace(/^vendor\t/gim, "Vendor\n");

  const lines = normalised.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const vendors = [];
  const SKIP = /^(vendor|type|name|email|direct deposit|actions|import from|add a vendor|not available|create bill|vendors|loading|\d+)$/i;

  // Non-transport keywords — skip these junk/billing entries
  const JUNK = /^(amazon|facebook|google play|fedex|usps|tmobile|sprint mobile|dell|verizon|optimum|capital one bank|paycargo|magicjack|identogo|indentogo|parnassa loan|liberty health share|universal enroll|test|meals|devil'?s bowl raceway|jewish learning center|necheles law|porsche financial|harland clarke|surety bonds direct|leshkowitz|american petroleum|seanautic marine)$/i;

  let i = 0;
  while (i < lines.length) {
    if (/^vendor$/i.test(lines[i])) {
      const nameLine    = lines[i + 1] || "";
      const contactLine = lines[i + 2] || "";

      if (nameLine && !SKIP.test(nameLine) && !JUNK.test(nameLine)) {
        const isContact = contactLine &&
          !SKIP.test(contactLine) &&
          !/^vendor$/i.test(contactLine) &&
          !/\d{4,}/.test(contactLine) &&
          !/@/.test(contactLine) &&   // skip email lines used as contacts
          contactLine.length < 60;

        vendors.push({
          name:        nameLine,
          contactName: isContact ? contactLine : "",
          category:    "Towing / Transport",
        });
        i += isContact ? 3 : 2;
        continue;
      }
    }
    i++;
  }
  return vendors;
}

async function main() {
  const txtPath = path.join(__dirname, "wave_vendors.txt");
  if (!fs.existsSync(txtPath)) {
    console.error("wave_vendors.txt not found — expected at:", txtPath);
    process.exit(1);
  }

  const text   = fs.readFileSync(txtPath, "utf8");
  const parsed = parseWavePaste(text);
  console.log(`\nParsed ${parsed.length} vendor entries from wave_vendors.txt`);

  if (parsed.length === 0) {
    console.error("No vendors parsed — check the file format.");
    process.exit(1);
  }

  // Show first 5 so we can confirm parsing worked
  console.log("\nSample (first 5):");
  parsed.slice(0, 5).forEach((v, i) => {
    console.log(`  ${i + 1}. ${v.name}${v.contactName ? " — " + v.contactName : ""}`);
  });
  console.log();

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected to MongoDB\n");

  let created = 0, skipped = 0, errors = 0;
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const v of parsed) {
    try {
      const exists = await Vendor.findOne({
        name: { $regex: `^${escRe(v.name)}$`, $options: "i" }
      }).lean();

      if (exists) {
        skipped++;
        continue;
      }

      await Vendor.create(v);
      created++;
      process.stdout.write(`  ✅ ${v.name}\n`);
    } catch (err) {
      console.error(`  ❌ [${v.name}]:`, err.message);
      errors++;
    }
  }

  console.log("\n─────────────────────────────────────────────────");
  console.log(`  ✅ Created  : ${created}`);
  console.log(`  ⏭  Skipped  : ${skipped} (already existed)`);
  if (errors) console.log(`  ❌ Errors   : ${errors}`);
  console.log(`  📦 Total    : ${parsed.length}`);
  console.log("─────────────────────────────────────────────────\n");

  await mongoose.disconnect();
  console.log("Done.");
}

main().catch(err => { console.error(err); process.exit(1); });
