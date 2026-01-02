import mongoose from 'mongoose';

const donationSchema = new mongoose.Schema({
  donor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  driver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  foodItems: [{
    name: {
      type: String,
      required: true
    },
    quantity: {
      type: Number,
      required: true
    },
    unit: {
      type: String,
      enum: ['kg', 'pieces', 'packets', 'liters', 'boxes'],
      required: true
    },
    description: String,
    expiryDate: Date
  }],
  pickupAddress: {
    street: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  status: {
    type: String,
    enum: ['available', 'reserved', 'assigned', 'picked_up', 'delivered', 'cancelled'],
    default: 'available'
  },
  preferredPickupTime: {
    type: Date,
    required: true
  },
  actualPickupTime: Date,
  actualDeliveryTime: Date,
  deliveryProof: {
    url: String,
    uploadedAt: Date
  },
  notes: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

donationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Donation = mongoose.model('Donation', donationSchema);
export default Donation;
