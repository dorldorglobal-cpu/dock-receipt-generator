require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose = require("mongoose");
const AddressBook = require("../models/AddressBook");

const MONGODB_URI = process.env.MONGODB_URI;

function containsGhana(record) {
  const fields = [
    record.country,
    record.address,
    record.city,
    record.state,
  ];
  return fields.some((f) => f && f.toUpperCase().includes("GHANA"));
}

function containsNigeria(record) {
  const fields = [
    record.country,
    record.address,
    record.city,
    record.state,
  ];
  return fields.some((f) => f && f.toUpperCase().includes("NIGERIA"));
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB.");

  // Find all customers with empty/null defaultPod
  const customers = await AddressBook.find({
    type: "customer",
    $or: [{ defaultPod: { $exists: false } }, { defaultPod: "" }, { defaultPod: null }],
  }).lean();

  console.log(`Found ${customers.length} customers with no defaultPod.\n`);

  const ghanaIds = [];
  const nigeriaIds = [];
  const uncertain = [];

  for (const c of customers) {
    if (containsGhana(c)) {
      ghanaIds.push(c._id);
    } else if (containsNigeria(c)) {
      nigeriaIds.push(c._id);
    } else {
      uncertain.push(c);
    }
  }

  // Update Ghana → TEMA
  if (ghanaIds.length > 0) {
    await AddressBook.updateMany(
      { _id: { $in: ghanaIds } },
      { $set: { defaultPod: "TEMA" } }
    );
  }

  // Update Nigeria → LAGOS
  if (nigeriaIds.length > 0) {
    await AddressBook.updateMany(
      { _id: { $in: nigeriaIds } },
      { $set: { defaultPod: "LAGOS" } }
    );
  }

  console.log(`Updated ${ghanaIds.length} records → defaultPod = "TEMA" (Ghana)`);
  console.log(`Updated ${nigeriaIds.length} records → defaultPod = "LAGOS" (Nigeria)`);
  console.log(`\n${uncertain.length} uncertain customers (no Ghana/Nigeria match):`);

  if (uncertain.length === 0) {
    console.log("  (none)");
  } else {
    console.log(
      `${"Company Name".padEnd(40)} ${"Country".padEnd(20)} ${"City".padEnd(20)} ${"State".padEnd(20)} Address`
    );
    console.log("-".repeat(120));
    for (const c of uncertain) {
      console.log(
        `${(c.companyName || "").padEnd(40)} ${(c.country || "").padEnd(20)} ${(c.city || "").padEnd(20)} ${(c.state || "").padEnd(20)} ${c.address || ""}`
      );
    }
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
