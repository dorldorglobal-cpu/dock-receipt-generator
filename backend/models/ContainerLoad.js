const mongoose = require("mongoose");

const containerLoadSchema = new mongoose.Schema({
  name:          { type: String, required: true },   // e.g. "LOAD-JUN29" or auto-generated
  orderIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  vessel:        { type: String, default: "" },
  pol:           { type: String, default: "" },
  pod:           { type: String, default: "" },
  loaderEmail:   { type: String, default: "" },
  bookingNumber: { type: String, default: "" },
  containerNumber: { type: String, default: "" },
  sealNumber:    { type: String, default: "" },
  notes:         { type: String, default: "" },
  emailSentAt:   { type: Date },
  status:        { type: String, default: "Pending" }, // Pending | Booked | Loaded | Sailed
}, { timestamps: true });

module.exports = mongoose.model("ContainerLoad", containerLoadSchema);
