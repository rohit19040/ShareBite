import express from 'express';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });
};

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, userType, address, adminCode } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Validate admin registration - require admin code
    if (userType === 'admin') {
      const validAdminCode = process.env.ADMIN_REGISTRATION_CODE || 'ADMIN_SECRET_2024';
      if (!adminCode || adminCode !== validAdminCode) {
        return res.status(403).json({ 
          message: 'Invalid admin registration code. Admin accounts require special authorization.' 
        });
      }
    }

    // Create new user
    const user = new User({
      name,
      email,
      password,
      phone,
      userType,
      address: address || {}
    });

    // Set default values for admin
    if (userType === 'admin') {
      user.kycStatus = 'verified'; // Admins are auto-verified
      user.reputationScore = 100; // Admins start with max reputation
      user.isActive = true;
    }

    await user.save();

    const token = generateToken(user._id);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        kycStatus: user.kycStatus,
        reputationScore: user.reputationScore,
        isActive: user.isActive,
        driverStatus: user.driverStatus,
        vehicleCapacity: user.vehicleCapacity,
        address: user.address
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Registration failed', error: error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        kycStatus: user.kycStatus,
        reputationScore: user.reputationScore,
        isActive: user.isActive,
        driverStatus: user.driverStatus,
        vehicleCapacity: user.vehicleCapacity,
        address: user.address
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Login failed', error: error.message });
  }
});

export default router;
