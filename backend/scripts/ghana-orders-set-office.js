/**
 * One-off: force `source = "GHANA OFFICE"` on every order whose customer is
 * Dor L'Dor Global Ghana. Going forward this is enforced in the order
 * create/update routes (see backend/utils/ghana.js), so this only needs to
 * run once to clean up history.
 *
 *   node backend/scripts/ghana-orders-set-office.js          # dry run
 *   node backend/scripts/ghana-orders-set-office.js --apply  # write
 */
require("dotenv").config();
const mongoose = require("mongoose");
const { isGhanaCustomer } = require("../utils/ghana");

(async () => {
  const apply = process.argv.includes("--apply");
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const Order = require("../models/Order");

  const all = await Order.find({}).select("_id refNumber customerName source").lean();
  const need = all.filter(o => isGhanaCustomer(o.customerName) && o.source !== "GHANA OFFICE");

  console.log(`${need.length} Ghana-customer order(s) need source = "GHANA OFFICE"`);
  need.forEach(o => console.log(`  ${o.refNumber}  (was "${o.source || ""}")`));

  if (apply && need.length) {
    const r = await Order.updateMany(
      { _id: { $in: need.map(o => o._id) } },
      { $set: { source: "GHANA OFFICE" } }
    );
    console.log(`Updated ${r.modifiedCount} order(s).`);
  } else if (!apply) {
    console.log("\nDry run — re-run with --apply to write.");
  }

  await mongoose.disconnect();
})().catch(e => { console.error(e); process.exit(1); });
