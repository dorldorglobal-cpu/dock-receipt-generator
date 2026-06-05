const mongoose = require("mongoose");

const pricingSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["towing", "ocean", "fee"],
      required: true,
    },

    name: {
      type: String,
    },

    pickupLocation: String,
    deliveryLocation: String,

    shippingLine: String,
    pol: String,
    pod: String,



    requestType: String,
    containerSize: String,
    condition: String,

address: String,
city: String,
state: String,
port: String,
warehouse: String,

portPrice: {
  type: Number,
  default: 0,
},

warehousePrice: {
  type: Number,
  default: 0,
},

cost: {
  type: Number,
  default: 0,
},

warehouseCost: {
  type: Number,
  default: 0,
},

    category: {
      type: String,
      enum: ["1", "2"],
      default: "1",
    },

    notes: String,

    active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Pricing", pricingSchema);