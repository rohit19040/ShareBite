import express from 'express';
import Donation from '../models/Donation.js';
import User from '../models/User.js';
import { authenticate, authorize, authorizeOwnerOrRole } from '../middleware/auth.js';
import { calculateDistance, calculateFoodQuantity, getVehicleCapacityKg, isDriverAvailable } from '../services/driverAssignment.js';

const router = express.Router();

// Get all available donations
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    
    const donations = await Donation.find(filter)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .populate('driver', 'name email phone')
      .sort({ createdAt: -1 });
    
    res.json(donations);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donations', error: error.message });
  }
});

// Get available donations (not yet reserved)
router.get('/available', async (req, res) => {
  try {
    const donations = await Donation.find({ status: 'available' })
      .populate('donor', 'name email phone address')
      .populate('driver', 'name email phone')
      .sort({ createdAt: -1 });
    
    res.json(donations);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch available donations', error: error.message });
  }
});

// Create new donation - only donors can create
router.post('/', authenticate, authorize('donor'), async (req, res) => {
  try {
    const { foodItems, pickupAddress, preferredPickupTime, notes } = req.body;
    const donor = req.userId; // Use authenticated user as donor

    if (!foodItems || foodItems.length === 0) {
      return res.status(400).json({ message: 'At least one food item is required' });
    }

    const donation = new Donation({
      donor: req.userId,
      foodItems,
      pickupAddress,
      preferredPickupTime,
      notes,
      status: 'available'
    });

    await donation.save();
    
    const populatedDonation = await Donation.findById(donation._id)
      .populate('donor', 'name email phone address');

    res.status(201).json({
      message: 'Donation created successfully',
      donation: populatedDonation
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create donation', error: error.message });
  }
});

// Get donation by ID
router.get('/:id', async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .populate('driver', 'name email phone');
    
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    res.json(donation);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donation', error: error.message });
  }
});

// Reserve/Claim donation - only receivers can reserve
router.patch('/:id/reserve', authenticate, authorize('receiver'), async (req, res) => {
  try {
    const receiver = req.userId; // Use authenticated user as receiver
    
    const donation = await Donation.findById(req.params.id);
    
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    if (donation.status !== 'available') {
      return res.status(400).json({ message: 'Donation is not available' });
    }

    donation.receiver = req.userId;
    donation.status = 'reserved';
    await donation.save();

    const populatedDonation = await Donation.findById(donation._id)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .populate('driver', 'name email phone address driverStatus vehicleCapacity');

    res.json({
      message: 'Donation reserved successfully',
      donation: populatedDonation
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to reserve donation', error: error.message });
  }
});

// Get available drivers for a donation (for manual assignment)
router.get('/:id/available-drivers', authenticate, authorize('receiver', 'donor'), async (req, res) => {
  try {
    const donation = await Donation.findById(req.params.id)
      .populate('donor', 'address');
    
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    if (!donation.pickupAddress?.coordinates) {
      return res.status(400).json({ 
        message: 'Donation missing pickup location coordinates',
        details: 'Please ensure the donation has a pickup address with coordinates set.'
      });
    }

    const pickupCoords = donation.pickupAddress.coordinates;
    const foodQuantity = calculateFoodQuantity(donation.foodItems);

    console.log(`Finding drivers for donation ${req.params.id}:`);
    console.log(`- Pickup coordinates: ${pickupCoords.lat}, ${pickupCoords.lng}`);
    console.log(`- Food quantity: ${foodQuantity} kg`);

    // Get all available drivers with location
    const allDrivers = await User.find({
      userType: 'driver',
      driverStatus: 'available',
      isActive: true,
      'address.coordinates.lat': { $exists: true, $ne: null },
      'address.coordinates.lng': { $exists: true, $ne: null }
    }).select('-password');

    console.log(`Found ${allDrivers.length} drivers with 'available' status and location`);

    // Filter and score drivers
    const eligibleDrivers = [];
    const filteredOut = {
      noActiveAssignments: 0,
      insufficientCapacity: 0,
      noLocation: 0
    };

    for (const driver of allDrivers) {
      // Check if driver is truly available (no active assignments)
      const isAvailable = await isDriverAvailable(driver._id);
      if (!isAvailable) {
        filteredOut.noActiveAssignments++;
        continue;
      }

      // Check vehicle capacity
      const vehicleCapacity = getVehicleCapacityKg(driver.vehicleCapacity || 'medium');
      if (vehicleCapacity < foodQuantity) {
        filteredOut.insufficientCapacity++;
        continue; // Driver's vehicle is too small
      }

      // Calculate distance from driver to pickup location
      const driverCoords = driver.address.coordinates;
      if (!driverCoords || !driverCoords.lat || !driverCoords.lng) {
        filteredOut.noLocation++;
        continue;
      }

      const distance = calculateDistance(
        driverCoords.lat,
        driverCoords.lng,
        pickupCoords.lat,
        pickupCoords.lng
      );

      // Calculate score (lower is better)
      const distanceScore = distance * 0.4;
      const reputationScore = (100 - driver.reputationScore) * 0.3;
      const capacityUtilization = (foodQuantity / vehicleCapacity) * 0.2;
      const totalScore = distanceScore + reputationScore + capacityUtilization;

      eligibleDrivers.push({
        id: driver._id,
        name: driver.name,
        email: driver.email,
        phone: driver.phone,
        distance: parseFloat(distance.toFixed(2)),
        capacity: vehicleCapacity,
        capacityUtilization: parseFloat((foodQuantity / vehicleCapacity * 100).toFixed(1)),
        vehicleCapacity: driver.vehicleCapacity || 'medium',
        reputationScore: driver.reputationScore,
        score: parseFloat(totalScore.toFixed(2))
      });
    }

    // Sort by score (lowest score = best match)
    eligibleDrivers.sort((a, b) => a.score - b.score);

    console.log(`Eligible drivers: ${eligibleDrivers.length}`);
    console.log(`Filtered out:`, filteredOut);

    res.json({
      drivers: eligibleDrivers,
      foodQuantity: parseFloat(foodQuantity.toFixed(2)),
      count: eligibleDrivers.length,
      debug: {
        totalDriversFound: allDrivers.length,
        filteredOut
      }
    });
  } catch (error) {
    console.error('Error fetching available drivers:', error);
    res.status(500).json({ message: 'Failed to fetch available drivers', error: error.message });
  }
});

// Assign driver to donation - only receivers or donors can assign
router.patch('/:id/assign-driver', authenticate, authorize('receiver', 'donor'), async (req, res) => {
  try {
    const { driver } = req.body;
    
    const donation = await Donation.findById(req.params.id);
    
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    if (donation.status !== 'reserved') {
      return res.status(400).json({ message: 'Donation must be reserved before assigning driver' });
    }

    // Verify driver exists and is available
    const driverUser = await User.findById(driver);
    if (!driverUser || driverUser.userType !== 'driver') {
      return res.status(404).json({ message: 'Driver not found' });
    }

    if (driverUser.driverStatus !== 'available') {
      return res.status(400).json({ message: 'Driver is not available' });
    }

    donation.driver = driver;
    donation.status = 'assigned';
    await donation.save();

    // Update driver status to busy
    driverUser.driverStatus = 'busy';
    await driverUser.save();

    const populatedDonation = await Donation.findById(donation._id)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .populate('driver', 'name email phone address driverStatus vehicleCapacity');

    res.json({
      message: 'Driver assigned successfully',
      donation: populatedDonation
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to assign driver', error: error.message });
  }
});

// Update donation status - donor, receiver, or driver can update based on status
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, actualPickupTime, actualDeliveryTime } = req.body;
    
    const donation = await Donation.findById(req.params.id);
    
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    // Check if user owns the donation or has permission
    const canUpdate = 
      donation.donor.toString() === req.userId.toString() ||
      donation.receiver?.toString() === req.userId.toString() ||
      donation.driver?.toString() === req.userId.toString();

    if (!canUpdate) {
      return res.status(403).json({ message: 'You do not have permission to update this donation' });
    }

    const oldStatus = donation.status;
    donation.status = status;
    if (actualPickupTime) {
      donation.actualPickupTime = actualPickupTime;
    }
    if (actualDeliveryTime) {
      donation.actualDeliveryTime = actualDeliveryTime;
    }
    
    await donation.save();

    // Update driver status when delivery is completed
    if (status === 'delivered' && donation.driver) {
      const driver = await User.findById(donation.driver);
      if (driver) {
        // Check if driver has other active assignments (excluding the current one being delivered)
        const activeAssignments = await Donation.countDocuments({
          driver: driver._id,
          _id: { $ne: donation._id }, // Exclude current donation
          status: { $in: ['assigned', 'picked_up'] }
        });
        
        // If no active assignments, set driver back to available
        if (activeAssignments === 0) {
          driver.driverStatus = 'available';
          await driver.save();
          console.log(`Driver ${driver.name} (${driver._id}) set to available after delivery completion`);
        } else {
          console.log(`Driver ${driver.name} (${driver._id}) still has ${activeAssignments} active assignment(s), keeping status as busy`);
        }
      }
    }

    const populatedDonation = await Donation.findById(donation._id)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .populate('driver', 'name email phone');

    res.json({
      message: 'Donation status updated successfully',
      donation: populatedDonation
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update donation status', error: error.message });
  }
});

// Upload delivery proof - only drivers can upload, and only for their own deliveries
router.patch('/:id/delivery-proof', authenticate, authorize('driver'), async (req, res) => {
  try {
    const { proofUrl } = req.body;
    
    const donation = await Donation.findById(req.params.id);
    
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    // Check if driver owns this delivery
    if (donation.driver?.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'You can only upload proof for your own deliveries' });
    }

    if (donation.status !== 'picked_up') {
      return res.status(400).json({ message: 'Donation must be picked up before uploading proof' });
    }

    donation.deliveryProof = {
      url: proofUrl,
      uploadedAt: new Date()
    };
    donation.status = 'delivered';
    donation.actualDeliveryTime = new Date();
    await donation.save();

    // Update driver status when delivery is completed
    if (donation.driver) {
      const driver = await User.findById(donation.driver);
      if (driver) {
        // Check if driver has other active assignments (excluding the current one being delivered)
        const activeAssignments = await Donation.countDocuments({
          driver: driver._id,
          _id: { $ne: donation._id }, // Exclude current donation
          status: { $in: ['assigned', 'picked_up'] }
        });
        
        // If no active assignments, set driver back to available
        if (activeAssignments === 0) {
          driver.driverStatus = 'available';
          await driver.save();
          console.log(`Driver ${driver.name} (${driver._id}) set to available after delivery completion`);
        } else {
          console.log(`Driver ${driver.name} (${driver._id}) still has ${activeAssignments} active assignment(s), keeping status as busy`);
        }
      }
    }

    const populatedDonation = await Donation.findById(donation._id)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .populate('driver', 'name email phone address driverStatus');

    res.json({
      message: 'Delivery proof uploaded successfully',
      donation: populatedDonation
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload delivery proof', error: error.message });
  }
});

export default router;
