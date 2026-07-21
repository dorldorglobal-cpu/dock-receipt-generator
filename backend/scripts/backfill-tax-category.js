require("dotenv").config({ path: require("path").join(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const Expense  = require("../models/Expense");

// Mirrors TAX_BY_CATEGORY in frontend/src/pages/Expenses.jsx — kept in sync manually.
const TAX_BY_CATEGORY = {
  "Towing / Transport":   "Cost of Goods Sold (COGS)",
  "Ocean Freight":        "Cost of Goods Sold (COGS)",
  "Storage":              "Cost of Goods Sold (COGS)",
  "Port / Terminal Fees": "Cost of Goods Sold (COGS)",
  "Loaders & Warehouses": "Cost of Goods Sold (COGS)",
  "Software":             "Cost of Goods Sold (COGS)",
  "Mailing Fees":         "Cost of Goods Sold (COGS)",
  "Legal Fees":           "Operating Expense",
  "Office & Admin":       "Operating Expense",
  "General Overhead":     "Operating Expense",
};

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("Connected\n");

  const blank = await Expense.find({ $or: [{ taxCategory: { $exists: false } }, { taxCategory: "" }] })
    .select("_id category").lean();

  console.log(`Found ${blank.length} expense(s) with blank taxCategory.\n`);

  const byCategory = {};
  for (const e of blank) {
    const tax = TAX_BY_CATEGORY[e.category];
    if (!tax) {
      console.log(`  SKIP [${e._id}] — unrecognized category "${e.category}"`);
      continue;
    }
    byCategory[tax] = byCategory[tax] || [];
    byCategory[tax].push(e._id);
  }

  let totalUpdated = 0;
  for (const [tax, ids] of Object.entries(byCategory)) {
    const result = await Expense.updateMany({ _id: { $in: ids } }, { $set: { taxCategory: tax } });
    console.log(`Set taxCategory="${tax}" on ${result.modifiedCount} record(s)`);
    totalUpdated += result.modifiedCount;
  }

  console.log(`\nTotal updated: ${totalUpdated}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
