require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Expense  = require("../models/Expense");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("Connected\n");

  // 1. Normalize vendor names
  const nameFixed = await Expense.updateMany(
    { vendor: "Grimaldi / ACL" },
    { $set: { vendor: "ACL / Grimaldi" } }
  );
  console.log(`Normalized "Grimaldi / ACL" -> "ACL / Grimaldi": ${nameFixed.modifiedCount} records\n`);

  // 2. Find duplicates: same orderRef + vendor + amount
  const all = await Expense.find({}).sort({ orderRef: 1, vendor: 1, amount: 1, date: 1 }).lean();

  const groups = {};
  for (const e of all) {
    if (!e.orderRef) continue;
    const key = `${e.orderRef}|${(e.vendor||"").toLowerCase().trim()}|${e.amount}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  }

  const dupGroups = Object.entries(groups).filter(([, arr]) => arr.length > 1);
  if (!dupGroups.length) {
    console.log("No duplicates found.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Found ${dupGroups.length} groups with potential duplicates:\n`);
  const fmt = d => d ? new Date(d).toLocaleDateString("en-US") : "-";

  for (const [key, arr] of dupGroups) {
    const [orderRef, vendor, amount] = key.split("|");
    console.log(`Order #${orderRef} | ${vendor} | $${amount}`);
    for (const e of arr) {
      console.log(`  [${e._id}]  Date: ${fmt(e.date)}  Status: ${e.status}  Desc: ${(e.description||"").slice(0,70)}`);
    }
    console.log();
  }

  const totalExtra = dupGroups.reduce((s,[,a]) => s + a.length - 1, 0);
  console.log(`Total duplicate groups: ${dupGroups.length}`);
  console.log(`Total extra (deletable) records: ${totalExtra}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
