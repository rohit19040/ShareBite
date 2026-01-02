import express from 'express';
import User from '../models/User.js';
import { authenticate, authorizeOwnerOrRole } from '../middleware/auth.js';

const router = express.Router();

// Update user profile (including location)
router.patch('/:id', authenticate, authorizeOwnerOrRole('id'), async (req, res) => {
  try {
    const { address, name, phone } = req.body;
    
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update allowed fields
    if (address) {
      user.address = {
        ...user.address,
        ...address,
        coordinates: address.coordinates || user.address?.coordinates
      };
    }
    
    if (name) user.name = name;
    if (phone) user.phone = phone;

    await user.save();

    const updatedUser = await User.findById(user._id).select('-password');

    res.json({
      message: 'Profile updated successfully',
      user: updatedUser
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update profile', error: error.message });
  }
});

// Get user profile
router.get('/:id', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch user', error: error.message });
  }
});

export default router;
