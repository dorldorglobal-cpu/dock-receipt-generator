const mongoose = require("mongoose");

const vendorSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    contactName: { type: String, default: "", trim: true },
    phone:       { type: String, default: "" },
    email:       { type: String, default: "" },
    address:     { type: String, default: "" },
    city:        { type: String, default: "" },
    state:       { type: String, default: "" },
    zip:         { type: String, default: "" },
    // What they primarily supply
    category:    { type: String, default: "" },
    notes:       { type: String, default: "" },
    // Who gets the "PAYMENT FOR RELEASES" email after we pay this vendor (carriers /
    // container loaders). One address per line, e.g. "Name <a@b.com>". Empty = none sent.
    releaseEmails: { type: String, default: "" },
    // Bank details for paying them. Account/routing numbers are encrypted
    // (utils/bankCrypt.js) and never sent in lists — only the last 4.
    bankName:         { type: String, default: "", trim: true },
    bankAccountName:  { type: String, default: "", trim: true },   // name on the account
    bankAccountType:  { type: String, default: "" },               // Checking / Savings
    bankAccountEnc:   { type: String, default: "", select: false },
    bankRoutingEnc:   { type: String, default: "", select: false },
    bankAccountLast4: { type: String, default: "" },
    bankRoutingLast4: { type: String, default: "" },
    bankUpdatedAt:    { type: Date },
    active:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Case-insensitive unique-ish index on name (warn, don't hard-block)
vendorSchema.index({ name: 1 });

module.exports = mongoose.model("Vendor", vendorSchema);
