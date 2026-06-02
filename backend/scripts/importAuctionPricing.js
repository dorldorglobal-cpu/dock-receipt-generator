const mongoose = require("mongoose");
require("dotenv").config();

const AddressBook = require("../models/AddressBook");
const Pricing = require("../models/Pricing");

async function run() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || process.env.MONGO_URI
    );

    console.log("MongoDB Connected");

    const auctions = await AddressBook.find({
      $or: [
        { companyName: /copart/i },
        { companyName: /iaa/i },
        { companyName: /i\.a\.a\./i },
        { address: /copart/i },
        { address: /iaa/i },
        { address: /i\.a\.a\./i },
      ],
    });

    console.log(`Found ${auctions.length} auction locations`);

    let created = 0;
    let skipped = 0;

    for (const a of auctions) {
      const exists = await Pricing.findOne({
        type: "towing",
        address: a.address || "",
        city: a.city || "",
        state: a.state || "",
      });

      if (exists) {
        skipped++;
        continue;
      }

      await Pricing.create({
        type: "towing",
        name: a.companyName || "",
        address: a.address || "",
        city: a.city || "",
        state: a.state || "",
        port: "",
        warehouse: "",
        portPrice: 0,
        warehousePrice: 0,
        notes: "Imported auction from Address Book",
      });

      created++;
    }

    console.log(`Created ${created} towing pricing rows`);
    console.log(`Skipped ${skipped} existing rows`);

    process.exit();
  } catch (err) {
    console.error("Import auction pricing error:", err);
    process.exit(1);
  }
}

run();