import express from 'express';
import User from '../models/User.js';
import Donation from '../models/Donation.js';
import { authenticate, authorizeOwnerOrRole } from '../middleware/auth.js';

const router = express.Router();

// Get all donors
router.get('/', async (req, res) => {
  try {
    const donors = await User.find({ userType: 'donor' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(donors);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donors', error: error.message });
  }
});

// Get donor by ID
router.get('/:id', async (req, res) => {
  try {
    const donor = await User.findById(req.params.id)
      .select('-password');
    
    if (!donor || donor.userType !== 'donor') {
      return res.status(404).json({ message: 'Donor not found' });
    }

    res.json(donor);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donor', error: error.message });
  }
});

// Get donations by donor - donor can only see their own
router.get('/:id/donations', authenticate, authorizeOwnerOrRole('id', 'donor'), async (req, res) => {
  try {
    const donations = await Donation.find({ donor: req.params.id })
      .populate('receiver', 'name email phone')
      .sort({ createdAt: -1 });
    res.json(donations);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donations', error: error.message });
  }
});

export default router;
