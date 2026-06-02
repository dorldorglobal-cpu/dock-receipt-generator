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
    active:      { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Case-insensitive unique-ish index on name (warn, don't hard-block)
vendorSchema.index({ name: 1 });

module.exports = mongoose.model("Vendor", vendorSchema);
