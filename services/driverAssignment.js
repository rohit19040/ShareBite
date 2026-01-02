import User from '../models/User.js';
import Donation from '../models/Donation.js';

// Calculate distance between two coordinates using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

// Calculate total food quantity in a standardized unit (kg equivalent)
function calculateFoodQuantity(foodItems) {
  let totalKg = 0;
  
  foodItems.forEach(item => {
    switch (item.unit) {
      case 'kg':
        totalKg += item.quantity;
        break;
      case 'liters':
        totalKg += item.quantity * 1; // Approximate: 1 liter ≈ 1 kg for most liquids
        break;
      case 'boxes':
        totalKg += item.quantity * 5; // Approximate: 1 box ≈ 5 kg
        break;
      case 'packets':
        totalKg += item.quantity * 0.5; // Approximate: 1 packet ≈ 0.5 kg
        break;
      case 'pieces':
        totalKg += item.quantity * 0.2; // Approximate: 1 piece ≈ 0.2 kg
        break;
      default:
        totalKg += item.quantity;
    }
  });
  
  return totalKg;
}

// Get vehicle capacity in kg
function getVehicleCapacityKg(vehicleCapacity) {
  const capacityMap = {
    'small': 50,   // Small vehicle: 50 kg
    'medium': 150, // Medium vehicle: 150 kg
    'large': 300   // Large vehicle: 300 kg
  };
  return capacityMap[vehicleCapacity] || 150;
}

// Check if driver is available (not busy and has available status)
async function isDriverAvailable(driverId) {
  const driver = await User.findById(driverId);
  if (!driver || driver.userType !== 'driver') {
    return false;
  }
  
  // Check driver status
  if (driver.driverStatus !== 'available') {
    return false;
  }
  
  // Check if driver has active assignments
  const activeAssignments = await Donation.countDocuments({
    driver: driverId,
    status: { $in: ['assigned', 'picked_up'] }
  });
  
  return activeAssignments === 0;
}

// Find and assign the best driver for a donation
async function assignDriver(donationId) {
  try {
    const donation = await Donation.findById(donationId)
      .populate('donor', 'address')
      .populate('receiver', 'address');
    
    if (!donation) {
      throw new Error('Donation not found');
    }
    
    if (!donation.pickupAddress?.coordinates || !donation.receiver?.address?.coordinates) {
      throw new Error('Donation or receiver missing location coordinates');
    }
    
    const pickupCoords = donation.pickupAddress.coordinates;
    const foodQuantity = calculateFoodQuantity(donation.foodItems);
    
    // Get all available drivers
    const allDrivers = await User.find({
      userType: 'driver',
      driverStatus: 'available',
      isActive: true,
      'address.coordinates.lat': { $exists: true },
      'address.coordinates.lng': { $exists: true }
    });
    
    if (allDrivers.length === 0) {
      return { success: false, message: 'No available drivers found' };
    }
    
    // Filter and score drivers
    const eligibleDrivers = [];
    
    for (const driver of allDrivers) {
      // Check if driver is truly available (no active assignments)
      const isAvailable = await isDriverAvailable(driver._id);
      if (!isAvailable) continue;
      
      // Check vehicle capacity
      const vehicleCapacity = getVehicleCapacityKg(driver.vehicleCapacity || 'medium');
      if (vehicleCapacity < foodQuantity) {
        continue; // Driver's vehicle is too small
      }
      
      // Calculate distance from driver to pickup location
      const driverCoords = driver.address.coordinates;
      const distance = calculateDistance(
        driverCoords.lat,
        driverCoords.lng,
        pickupCoords.lat,
        pickupCoords.lng
      );
      
      // Calculate score (lower is better)
      // Factors: distance (40%), reputation (30%), capacity utilization (20%), availability (10%)
      const distanceScore = distance * 0.4;
      const reputationScore = (100 - driver.reputationScore) * 0.3; // Lower reputation = higher score (worse)
      const capacityUtilization = (foodQuantity / vehicleCapacity) * 0.2; // Prefer better capacity match
      const availabilityScore = 0.1; // All are available at this point
      
      const totalScore = distanceScore + reputationScore + capacityUtilization + availabilityScore;
      
      eligibleDrivers.push({
        driver: driver,
        distance: distance,
        capacity: vehicleCapacity,
        capacityUtilization: foodQuantity / vehicleCapacity,
        reputation: driver.reputationScore,
        score: totalScore
      });
    }
    
    if (eligibleDrivers.length === 0) {
      return { success: false, message: 'No eligible drivers found (capacity or availability constraints)' };
    }
    
    // Sort by score (lowest score = best match)
    eligibleDrivers.sort((a, b) => a.score - b.score);
    
    // Assign the best driver
    const bestDriver = eligibleDrivers[0].driver;
    
    donation.driver = bestDriver._id;
    donation.status = 'assigned';
    await donation.save();
    
    // Update driver status to busy
    bestDriver.driverStatus = 'busy';
    await bestDriver.save();
    
    // Populate the donation for response
    const populatedDonation = await Donation.findById(donation._id)
      .populate('donor', 'name email phone address')
      .populate('receiver', 'name email phone address')
      .populate('driver', 'name email phone address driverStatus vehicleCapacity');
    
    return {
      success: true,
      message: 'Driver assigned successfully',
      donation: populatedDonation,
      assignedDriver: {
        id: bestDriver._id,
        name: bestDriver.name,
        distance: eligibleDrivers[0].distance.toFixed(2),
        capacity: eligibleDrivers[0].capacity
      },
      alternatives: eligibleDrivers.slice(1, 4).map(d => ({
        id: d.driver._id,
        name: d.driver.name,
        distance: d.distance.toFixed(2),
        capacity: d.capacity
      }))
    };
  } catch (error) {
    console.error('Driver assignment error:', error);
    return {
      success: false,
      message: 'Failed to assign driver',
      error: error.message
    };
  }
}

export {
  assignDriver,
  calculateDistance,
  calculateFoodQuantity,
  getVehicleCapacityKg,
  isDriverAvailable
};
