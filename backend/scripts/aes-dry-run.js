/**
 * Build the AES WebLink filing for an order and print it — no CBP contact,
 * no writes.
 *
 *   node backend/scripts/aes-dry-run.js <orderRef|orderId>
 *   node backend/scripts/aes-dry-run.js 14204
 *   node backend/scripts/aes-dry-run.js --recent 5     # last 5 orders
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const { buildWeblinkFiling } = require("../utils/aesWeblink");

(async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  const Order = require("../models/Order");
  const AesConfig = require("../models/AesConfig");
  const config = await AesConfig.getSingleton();

  const args = process.argv.slice(2);
  let orders = [];
  if (args[0] === "--recent") {
    orders = await Order.find({}).sort({ createdAt: -1 }).limit(Number(args[1] || 3));
  } else if (args[0]) {
    const key = args[0].trim();
    orders = await Order.find(
      mongoose.isValidObjectId(key) ? { _id: key } : { refNumber: key }
    );
  }
  if (!orders.length) { console.error("No matching order. Pass an order ref/id or --recent N."); process.exit(1); }

  for (const order of orders) {
    const built = buildWeblinkFiling(order, config, {
      srn: (order.aesFiling && order.aesFiling.srn) || undefined,
      returnToken: (order.aesFiling && order.aesFiling.returnToken) || "DRYRUN",
    });
    console.log("\n" + "═".repeat(72));
    console.log(`Order ${order.refNumber}  ·  ${order.vehicleYearMakeModel || [order.year, order.make, order.model].filter(Boolean).join(" ")}`);
    console.log(`VIN ${order.vin || "—"}  ·  ${order.requestType}  ·  ${order.pol || "?"} → ${order.pod || "?"}`);
    console.log(`SRN ${built.meta.srn}   env=${built.meta.env}`);
    console.log(`action ${built.actionUrl}`);
    console.log("─".repeat(72));
    console.log("FIELDS:");
    for (const [k, v] of Object.entries(built.fields)) console.log(`  ${k.padEnd(16)} ${v}`);
    console.log(`\nMISSING (${built.missing.length}):`);
    built.missing.forEach((m) => console.log(`  ✗ ${m.field.padEnd(10)} ${m.label} — ${m.reason}`));
    console.log(`\nWARNINGS (${built.warnings.length}):`);
    built.warnings.forEach((w) => console.log(`  ⚠ ${w.field.padEnd(10)} ${w.label} — ${w.note}`));
  }

  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
