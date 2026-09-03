const mongoose = require("mongoose");

const emailOrderSchema = new mongoose.Schema({
  gmailMessageId: { type: String, unique: true },
  status: { type: String, default: "pending" }, // pending | approved | rejected | no-pdf

  // Extracted fields
  customerName:  String,
  requestType:   String,
  lot:           String,
  vin:           String,
  year:          String,
  make:          String,
  model:         String,
  color:         String,
  pickupAddress: String,
  pickupCity:    String,
  pickupState:   String,
  pickupZip:     String,
  pin:           String,
  buyerNumber:   String,
  saleDate:      String,
  charges:       mongoose.Schema.Types.Mixed,

  // Raw data kept for upload and audit
  pdfBuffer:  Buffer,
  pdfFilename: String,
  bodyText:   String,

  // Set after approval
  orderId:    { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
  orderRef:   String,
}, { timestamps: true });

module.exports = mongoose.model("EmailOrder", emailOrderSchema);
