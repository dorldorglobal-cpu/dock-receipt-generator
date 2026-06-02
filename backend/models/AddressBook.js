const mongoose = require("mongoose");

const addressBookSchema = new mongoose.Schema(
  {
    companyName: String,
    contactName: String,
    address: String,
    city: String,
    state: String,
    postalCode: String,
    country: String,
    phone: String,
    email: String,
    type: String,
    notes: String,
    defaultPod: { type: String, default: "" }, // e.g. "LAGOS", "TEMA" — auto-fills POD on new orders
    buyerAccounts: { type: [String], default: [] }, // auction account names that belong to this customer
    balance: Number,
    overdue: Number,
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "AddressBook",
  addressBookSchema
);