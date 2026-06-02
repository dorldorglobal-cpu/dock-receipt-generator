const mongoose = require("mongoose");
const XLSX = require("xlsx");
require("dotenv").config();

const AddressBook = require("../models/AddressBook");

function clean(value) {
  return (value || "").toString().trim();
}

function getValue(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null) {
      return row[name];
    }
  }

  return "";
}

async function run() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || process.env.MONGO_URI
    );

    console.log("MongoDB Connected");

    const workbook = XLSX.readFile("./imports/address-book.xlsx");

    const sheetName = "ADDRESS LIST";

    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      throw new Error("Could not find sheet named ADDRESS LIST");
    }

    const rows = XLSX.utils.sheet_to_json(sheet, {
      defval: "",
    });

    console.log(`Found ${rows.length} rows in ADDRESS LIST`);

    await AddressBook.deleteMany({});
    console.log("Deleted old address book records");

    let imported = 0;

    for (const row of rows) {
      const companyName = clean(
        getValue(row, [
          "Company Name",
          "Name",
          "Location",
          "Terminal",
          "Port",
          "Warehouse",
        ])
      );

      if (!companyName) continue;

      await AddressBook.create({
        companyName,

        contactName: clean(
          getValue(row, ["Contact Name", "Contact", "Contact Person"])
        ),

        address: clean(
          getValue(row, [
            "Billing Address",
            "Address",
            "Street Address",
            "Location Address",
          ])
        ),

        city: clean(getValue(row, ["City"])),

        state: clean(
          getValue(row, ["State", "State or Province", "Province"])
        ),

        postalCode: clean(
          getValue(row, ["Postal Code", "Zip", "ZIP", "Zip Code"])
        ),

        country: clean(
          getValue(row, ["Country", "Country/ Region", "Country/Region"])
        ),

        phone: clean(
          getValue(row, ["Phone", "Phone Number", "Telephone"])
        ),

        email: clean(
          getValue(row, ["Email", "E-Mail Address", "E-Mail", "Email Address"])
        ),

        type: clean(getValue(row, ["Type"])) || "general",

        notes: "Imported from ADDRESS LIST",
      });

      imported++;
    }

    console.log(`Imported ${imported} addresses`);

    process.exit();
  } catch (err) {
    console.error("IMPORT ERROR:", err);
    process.exit(1);
  }
}

run();