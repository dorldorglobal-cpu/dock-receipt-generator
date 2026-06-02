const mongoose = require("mongoose");

const scheduleRowSchema = new mongoose.Schema({
  carrier: { type: String, required: true }, // 'SALLAUM' | 'ACL'
  vessel: { type: String, required: true },
  voyage: { type: String, required: true },
  pol: { type: String, required: true }, // port of loading (normalized)
  pod: { type: String, required: true }, // port of discharge (normalized)
  cutoffDate: { type: String, default: "" },
  sailDate: { type: String, default: "" },
  arrivalDate: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});

scheduleRowSchema.index({ vessel: 1, pol: 1, pod: 1 });
scheduleRowSchema.index({ carrier: 1, updatedAt: -1 });

module.exports = mongoose.model("ScheduleRow", scheduleRowSchema);
