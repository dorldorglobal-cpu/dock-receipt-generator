require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Invoice  = require("../models/Invoice");
const Order    = require("../models/Order");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  const paidInvoices = await Invoice.find({ status: "paid" }).lean();
  console.log(`Found ${paidInvoices.length} paid invoices`);

  let updated = 0, skipped = 0, notFound = 0;

  for (const inv of paidInvoices) {
    if (!inv.orderId) { skipped++; continue; }
    const order = await Order.findById(inv.orderId);
    if (!order) { notFound++; continue; }
    if (order.status === "Completed") { skipped++; continue; }

    await Order.findByIdAndUpdate(inv.orderId, {
      $set: { status: "Completed" },
      $push: { timeline: {
        action: "Invoice Paid",
        details: `Backfill: Invoice ${inv.invoiceNumber} was paid — order marked Completed`,
        createdAt: new Date(),
      }},
    });
    console.log(`  ✓ Order #${order.refNumber} (${order.customerName}) → Completed`);
    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Already completed: ${skipped}, No order found: ${notFound}`);
  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
