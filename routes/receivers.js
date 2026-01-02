import express from 'express';
import User from '../models/User.js';
import Donation from '../models/Donation.js';
import { authenticate, authorizeOwnerOrRole } from '../middleware/auth.js';

const router = express.Router();

// Get all receivers
router.get('/', async (req, res) => {
  try {
    const receivers = await User.find({ userType: 'receiver' })
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(receivers);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch receivers', error: error.message });
  }
});

// Get receiver by ID
router.get('/:id', async (req, res) => {
  try {
    const receiver = await User.findById(req.params.id)
      .select('-password');
    
    if (!receiver || receiver.userType !== 'receiver') {
      return res.status(404).json({ message: 'Receiver not found' });
    }

    res.json(receiver);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch receiver', error: error.message });
  }
});

// Get donations received by receiver - receiver can only see their own
router.get('/:id/donations', authenticate, authorizeOwnerOrRole('id', 'receiver'), async (req, res) => {
  try {
    const donations = await Donation.find({ receiver: req.params.id })
      .populate('donor', 'name email phone')
      .sort({ createdAt: -1 });
    res.json(donations);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donations', error: error.message });
  }
});

export default router;
