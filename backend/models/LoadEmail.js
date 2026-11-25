const mongoose = require("mongoose");

// One row per Ghana office load email the inbox scan has looked at
// (utils/ghanaLoadWatch.js) — so each email is handled once, and a changed
// list for a load that already exists is shown for a person to act on.
const loadEmailSchema = new mongoose.Schema({
  gmailId:    { type: String, required: true, unique: true },
  subject:    { type: String, default: "" },
  from:       { type: String, default: "" },
  receivedAt: { type: Date },
  ref:        { type: String, default: "" },
  // created = new draft load · changed = load exists, list differs · same = load exists, nothing new · skipped = no cars found
  result:     { type: String, default: "" },
  loadId:     { type: mongoose.Schema.Types.ObjectId, ref: "ContainerLoad", default: null },
  loadName:   { type: String, default: "" },
  added:      [{ type: String }],   // "2021 NISSAN VERSA 3N1CN8EV9ML913594"
  removed:    [{ type: String }],
  partsAdded: [{ type: String }],
  note:       { type: String, default: "" },
  dismissed:  { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model("LoadEmail", loadEmailSchema);
