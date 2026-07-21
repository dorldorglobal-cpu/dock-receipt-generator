require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Expense  = require("../models/Expense");

// Savannah Auto Export, iShip, E-Z Cargo, Cedars (Express) — always Loaders & Warehouses / COGS
const VENDOR_RX = /e-?z\s*cargo|savannah|i-?ship|cedars/i;
const CATEGORY = "Loaders & Warehouses";
const TAX_CATEGORY = "Cost of Goods Sold (COGS)";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("Connected\n");

  const candidates = await Expense.find({ vendor: { $regex: VENDOR_RX } })
    .select("_id vendor category taxCategory amount date orderRef")
    .lean();

  console.log(`Found ${candidates.length} expense(s) from matching vendors.\n`);

  const wrong = candidates.filter(e => e.category !== CATEGORY || e.taxCategory !== TAX_CATEGORY);

  if (!wrong.length) {
    console.log("All matching expenses are already correctly marked. Nothing to fix.");
    await mongoose.disconnect();
    return;
  }

  console.log(`${wrong.length} expense(s) need fixing:\n`);
  const fmt = d => d ? new Date(d).toLocaleDateString("en-US") : "-";
  for (const e of wrong) {
    console.log(`  [${e._id}]  ${fmt(e.date)}  ${e.vendor}  $${e.amount}  Order #${e.orderRef || "-"}  ` +
      `category: "${e.category}" -> "${CATEGORY}"  taxCategory: "${e.taxCategory || ""}" -> "${TAX_CATEGORY}"`);
  }

  const result = await Expense.updateMany(
    { _id: { $in: wrong.map(e => e._id) } },
    { $set: { category: CATEGORY, taxCategory: TAX_CATEGORY } }
  );

  console.log(`\nUpdated ${result.modifiedCount} record(s).`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
