const mongoose = require("mongoose");

const aiRuleSchema = new mongoose.Schema({
  docType: { type: String, required: true, unique: true }, // e.g. "IAA Buyer Receipt", "Dispatch Sheet"
  instructions: { type: String, default: "" },             // extra extraction instructions saved by staff
  exampleFields: { type: mongoose.Schema.Types.Mixed, default: {} }, // last good extraction as reference
}, { timestamps: true });

module.exports = mongoose.model("AiRule", aiRuleSchema);
