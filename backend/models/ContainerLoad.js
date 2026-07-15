const mongoose = require("mongoose");

const containerLoadSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  orderIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
  vessel:        { type: String, default: "" },
  pol:           { type: String, default: "" },
  pod:           { type: String, default: "" },
  loaderEmail:   { type: String, default: "" },
  bookingNumber: { type: String, default: "" },
  containerNumber: { type: String, default: "" },
  sealNumber:    { type: String, default: "" },
  sailCutoff:    { type: String, default: "" },
  arrivalDate:   { type: String, default: "" },
  notes:         { type: String, default: "" },
  emailSentAt:   { type: Date },
  status:        { type: String, default: "Pending" },

  // Consignee info (for loader email)
  consigneeName:    { type: String, default: "" },
  consigneeAddress: { type: String, default: "" },
  consigneePhone:   { type: String, default: "" },
  consigneeEmail:   { type: String, default: "" },
  consigneeTin:     { type: String, default: "" },

  // Notify party info
  notifyName:    { type: String, default: "" },
  notifyAddress: { type: String, default: "" },
  notifyPhone:   { type: String, default: "" },
  notifyEmail:   { type: String, default: "" },
  notifyTin:     { type: String, default: "" },

  driveFolderId:   { type: String, default: "" },
  driveFolderLink: { type: String, default: "" },

  files: [{
    label:        { type: String, default: "Document" },
    originalName: String,
    filename:     String,
    driveFileId:  String,
    driveUrl:     String,
    mimetype:     String,
    uploadedAt:   { type: Date, default: Date.now },
  }],
}, { timestamps: true });

module.exports = mongoose.model("ContainerLoad", containerLoadSchema);
