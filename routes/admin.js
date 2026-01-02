import express from 'express';
import User from '../models/User.js';
import Donation from '../models/Donation.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = express.Router();

// All admin routes require authentication and admin role
router.use(authenticate);
router.use(authorize('admin'));

// Get all users with filters
router.get('/users', async (req, res) => {
  try {
    const { userType, kycStatus, isActive, search } = req.query;
    const query = {};

    if (userType && userType !== 'all') {
      query.userType = userType;
    }

    if (kycStatus && kycStatus !== 'all') {
      query.kycStatus = kycStatus;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query).select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch users', error: error.message });
  }
});

// Get single user details
router.get('/users/:id', async (req, res) => {
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

// Update user (KYC status, reputation, active status, driver status)
router.patch('/users/:id', async (req, res) => {
  try {
    const { kycStatus, reputationScore, isActive, driverStatus } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (kycStatus) user.kycStatus = kycStatus;
    if (reputationScore !== undefined) user.reputationScore = reputationScore;
    if (isActive !== undefined) user.isActive = isActive;
    if (driverStatus && user.userType === 'driver') {
      if (['available', 'busy'].includes(driverStatus)) {
        user.driverStatus = driverStatus;
      }
    }

    await user.save();
    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update user', error: error.message });
  }
});

// Get analytics dashboard data
router.get('/analytics', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalDonors = await User.countDocuments({ userType: 'donor' });
    const totalReceivers = await User.countDocuments({ userType: 'receiver' });
    const totalDrivers = await User.countDocuments({ userType: 'driver' });

    const activeDonations = await Donation.countDocuments({ 
      status: { $in: ['available', 'reserved', 'assigned', 'picked_up'] } 
    });
    const completedDonations = await Donation.countDocuments({ status: 'delivered' });
    const cancelledDonations = await Donation.countDocuments({ status: 'cancelled' });
    const totalDonations = await Donation.countDocuments();

    // Match rate calculation (reserved + assigned + delivered / total)
    const matchedDonations = await Donation.countDocuments({
      status: { $in: ['reserved', 'assigned', 'picked_up', 'delivered'] }
    });
    const matchRate = totalDonations > 0 ? (matchedDonations / totalDonations * 100).toFixed(2) : 0;

    // KYC statistics
    const kycVerified = await User.countDocuments({ kycStatus: 'verified' });
    const kycPending = await User.countDocuments({ kycStatus: 'pending' });
    const kycRejected = await User.countDocuments({ kycStatus: 'rejected' });

    // Reputation score statistics
    const avgReputation = await User.aggregate([
      { $group: { _id: null, avgScore: { $avg: '$reputationScore' } } }
    ]);
    const avgRep = avgReputation.length > 0 ? avgReputation[0].avgScore.toFixed(2) : 100;

    // Donations over time (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const donationsLast7Days = await Donation.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    // User registrations over time (last 7 days)
    const usersLast7Days = await User.countDocuments({
      createdAt: { $gte: sevenDaysAgo }
    });

    res.json({
      users: {
        total: totalUsers,
        donors: totalDonors,
        receivers: totalReceivers,
        drivers: totalDrivers,
        newLast7Days: usersLast7Days
      },
      donations: {
        total: totalDonations,
        active: activeDonations,
        completed: completedDonations,
        cancelled: cancelledDonations,
        newLast7Days: donationsLast7Days,
        matchRate: parseFloat(matchRate)
      },
      trust: {
        kycVerified,
        kycPending,
        kycRejected,
        avgReputation: parseFloat(avgRep)
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch analytics', error: error.message });
  }
});

// Get donation statistics
router.get('/donations/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const query = {};

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const stats = await Donation.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const statusCounts = {
      available: 0,
      reserved: 0,
      assigned: 0,
      picked_up: 0,
      delivered: 0,
      cancelled: 0
    };

    stats.forEach(stat => {
      statusCounts[stat._id] = stat.count;
    });

    res.json(statusCounts);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donation stats', error: error.message });
  }
});

// Get all donations
router.get('/donations', async (req, res) => {
  try {
    const donations = await Donation.find()
      .populate('donor', 'name email')
      .populate('receiver', 'name email')
      .populate('driver', 'name email')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(donations);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch donations', error: error.message });
  }
});

// Create incident report
router.post('/incidents', async (req, res) => {
  try {
    // For now, we'll store incidents in a simple format
    // In production, you'd want a separate Incident model
    const { userId, donationId, type, description, severity } = req.body;
    
    // This is a placeholder - in production, create an Incident model
    res.json({
      message: 'Incident reported successfully',
      incident: {
        id: Date.now().toString(),
        userId,
        donationId,
        type,
        description,
        severity: severity || 'medium',
        reportedAt: new Date(),
        status: 'pending'
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to create incident', error: error.message });
  }
});

// Get incident reports (placeholder - would use Incident model in production)
router.get('/incidents', async (req, res) => {
  try {
    // Placeholder data - in production, fetch from Incident model
    res.json({
      incidents: [],
      message: 'No incidents reported yet'
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch incidents', error: error.message });
  }
});

export default router;
