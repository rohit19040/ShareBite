import express from 'express';
import Donation from '../models/Donation.js';
import User from '../models/User.js';
import { authenticate, authorize, authorizeOwnerOrRole } from '../middleware/auth.js';

const router = express.Router();

// Get all drivers
router.get('/', async (req, res) => {
  try {
    const drivers = await User.find({ userType: 'driver' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(drivers);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch drivers', error: error.message });
  }
});

// Get driver by ID
router.get('/:id', async (req, res) => {
  try {
    const driver = await User.findById(req.params.id)
      .select('-password');
    
    if (!driver || driver.userType !== 'driver') {
      return res.status(404).json({ message: 'Driver not found' });
    }
    
    res.json(driver);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch driver', error: error.message });
  }
});

// Get available pickups (reserved but not assigned to driver)
router.get('/available-pickups', async (req, res) => {
  try {
    const pickups = await Donation.find({
      status: 'reserved',
      driver: null
    })
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .sort({ preferredPickupTime: 1 });
    
    res.json(pickups);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch available pickups', error: error.message });
  }
});

// Get assigned pickups for a driver - driver can only see their own
router.get('/:id/pickups', authenticate, authorizeOwnerOrRole('id', 'driver'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { driver: req.params.id };
    
    if (status) {
      filter.status = status;
    } else {
      // Get active pickups (assigned, picked_up)
      filter.status = { $in: ['assigned', 'picked_up'] };
    }
    
    const pickups = await Donation.find(filter)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .sort({ preferredPickupTime: 1 });
    
    res.json(pickups);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch pickups', error: error.message });
  }
});

// Get delivery history for a driver - driver can only see their own
router.get('/:id/history', authenticate, authorizeOwnerOrRole('id', 'driver'), async (req, res) => {
  try {
    const deliveries = await Donation.find({
      driver: req.params.id,
      status: 'delivered'
    })
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .sort({ actualDeliveryTime: -1 });
    
    res.json(deliveries);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch delivery history', error: error.message });
  }
});

// Update driver status - driver can only update their own status
router.patch('/:id/status', authenticate, authorizeOwnerOrRole('id', 'driver'), async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['available', 'busy'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be: available or busy' });
    }
    
    const driver = await User.findById(req.params.id);
    
    if (!driver || driver.userType !== 'driver') {
      return res.status(404).json({ message: 'Driver not found' });
    }
    
    driver.driverStatus = status;
    await driver.save();
    
    res.json({ 
      message: 'Driver status updated successfully', 
      driver: {
        id: driver._id,
        name: driver.name,
        driverStatus: driver.driverStatus
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update driver status', error: error.message });
  }
});

export default router;
