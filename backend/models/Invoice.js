const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },

    orderId:  { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    orderRef: String,

    customerName:  String,
    customerEmail: String,
    customerPhone: String,

    vehicle:          String,   // "2019 Toyota Camry"
    vin:              String,
    pol:              String,
    pod:              String,
    requestType:      String,   // "RORO" | "Container" | "Inland Only"
    pickupLocation:   String,
    deliveryLocation: String,
    bookingNumber:    String,
    voyage:           String,
    arrivalDate:      String,
    shippingLine:     String,

    items: [
      {
        description: { type: String, default: "" },
        amount:      { type: Number, default: 0 },
      },
    ],

    subtotal: { type: Number, default: 0 },
    total:    { type: Number, default: 0 },

    notes:   String,
    dueDate: Date,

    status: {
      type:    String,
      enum:    ["draft", "sent", "paid"],
      default: "draft",
    },

    sentAt: Date,
    paidAt: Date,

    // Overdue-reminder automation (see services/invoiceReminders.js)
    // reminderStage: 0 = none sent, 1 = arrival-day notice sent, 2 = +3-day
    // sent, 3 = +7-day/weekly sent (after which reminders go daily, gated by
    // lastReminderSentAt rather than advancing the stage further).
    reminderStage:      { type: Number, default: 0 },
    lastReminderSentAt: { type: Date,   default: null },

    payments: [
      {
        amount:  { type: Number, required: true },
        method:  { type: String, default: "" },  // "Bank ACH", "Wire", "Zelle", etc.
        date:    { type: Date,   default: Date.now },
        notes:   { type: String, default: "" },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", invoiceSchema);
