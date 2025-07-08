const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/profile', authenticateToken, async (req, res) => {
  try {
    let profileQuery;
    let profileTable;

    switch (req.user.user_type) {
      case 'agent':
        profileTable = 'agent_profiles';
        profileQuery = `
          SELECT ap.*, u.email, u.first_name, u.last_name, u.phone, u.profile_image_url
          FROM agent_profiles ap
          JOIN users u ON ap.user_id = u.id
          WHERE ap.user_id = $1
        `;
        break;
      case 'ppo':
        profileTable = 'ppo_profiles';
        profileQuery = `
          SELECT pp.*, u.email, u.first_name, u.last_name, u.phone, u.profile_image_url
          FROM ppo_profiles pp
          JOIN users u ON pp.user_id = u.id
          WHERE pp.user_id = $1
        `;
        break;
      case 'client':
        profileTable = 'client_profiles';
        profileQuery = `
          SELECT cp.*, u.email, u.first_name, u.last_name, u.phone, u.profile_image_url
          FROM client_profiles cp
          JOIN users u ON cp.user_id = u.id
          WHERE cp.user_id = $1
        `;
        break;
      default:
        return res.status(400).json({ error: 'Invalid user type' });
    }

    const result = await pool.query(profileQuery, [req.user.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({ profile: result.rows[0] });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});

router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const client = await pool.connect();
    await client.query('BEGIN');

    const { firstName, lastName, phone, profileImageUrl } = req.body;
    
    await client.query(
      'UPDATE users SET first_name = $1, last_name = $2, phone = $3, profile_image_url = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5',
      [firstName, lastName, phone, profileImageUrl, req.user.id]
    );

    if (req.user.user_type === 'agent') {
      const { licenseNumber, licenseState, licenseExpiry, certifications, experienceYears, hourlyRate } = req.body;
      await client.query(
        `UPDATE agent_profiles SET 
         license_number = $1, license_state = $2, license_expiry = $3, 
         certifications = $4, experience_years = $5, hourly_rate = $6
         WHERE user_id = $7`,
        [licenseNumber, licenseState, licenseExpiry, certifications, experienceYears, hourlyRate, req.user.id]
      );
    } else if (req.user.user_type === 'ppo') {
      const { companyName, licenseNumber, licenseState, licenseExpiry, insurancePolicyNumber, bondingAmount } = req.body;
      await client.query(
        `UPDATE ppo_profiles SET 
         company_name = $1, license_number = $2, license_state = $3, 
         license_expiry = $4, insurance_policy_number = $5, bonding_amount = $6
         WHERE user_id = $7`,
        [companyName, licenseNumber, licenseState, licenseExpiry, insurancePolicyNumber, bondingAmount, req.user.id]
      );
    } else if (req.user.user_type === 'client') {
      const { companyName, industry, companySize, billingAddress } = req.body;
      await client.query(
        `UPDATE client_profiles SET 
         company_name = $1, industry = $2, company_size = $3, billing_address = $4
         WHERE user_id = $5`,
        [companyName, industry, companySize, billingAddress, req.user.id]
      );
    }

    await client.query('COMMIT');
    client.release();

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/agents', authenticateToken, requireRole(['ppo', 'client']), async (req, res) => {
  try {
    const { lat, lng, radius = 50, certifications, minRating = 0 } = req.query;

    let query = `
      SELECT 
        u.id, u.first_name, u.last_name, u.profile_image_url,
        ap.license_number, ap.license_state, ap.certifications, 
        ap.experience_years, ap.hourly_rate, ap.availability_status,
        ap.location_lat, ap.location_lng, ap.rating, ap.total_jobs
      FROM users u
      JOIN agent_profiles ap ON u.id = ap.user_id
      WHERE u.user_type = 'agent' AND u.is_active = true 
      AND ap.availability_status = 'available'
      AND ap.background_check_status = 'approved'
      AND ap.rating >= $1
    `;

    const params = [minRating];
    let paramCount = 1;

    if (lat && lng && radius) {
      paramCount++;
      query += ` AND (
        6371 * acos(
          cos(radians($${paramCount})) * cos(radians(ap.location_lat)) *
          cos(radians(ap.location_lng) - radians($${paramCount + 1})) +
          sin(radians($${paramCount})) * sin(radians(ap.location_lat))
        )
      ) <= $${paramCount + 2}`;
      params.push(lat, lng, radius);
      paramCount += 2;
    }

    if (certifications) {
      paramCount++;
      query += ` AND ap.certifications && $${paramCount}`;
      params.push(certifications.split(','));
    }

    query += ' ORDER BY ap.rating DESC, ap.total_jobs DESC';

    const result = await pool.query(query, params);
    res.json({ agents: result.rows });
  } catch (error) {
    console.error('Get agents error:', error);
    res.status(500).json({ error: 'Failed to get agents' });
  }
});

router.put('/location', authenticateToken, requireRole(['agent']), async (req, res) => {
  try {
    const { lat, lng } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude required' });
    }

    await pool.query(
      'UPDATE agent_profiles SET location_lat = $1, location_lng = $2 WHERE user_id = $3',
      [lat, lng, req.user.id]
    );

    res.json({ message: 'Location updated successfully' });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

router.put('/availability', authenticateToken, requireRole(['agent']), async (req, res) => {
  try {
    const { status } = req.body;

    if (!['available', 'busy', 'offline'].includes(status)) {
      return res.status(400).json({ error: 'Invalid availability status' });
    }

    await pool.query(
      'UPDATE agent_profiles SET availability_status = $1 WHERE user_id = $2',
      [status, req.user.id]
    );

    res.json({ message: 'Availability updated successfully' });
  } catch (error) {
    console.error('Update availability error:', error);
    res.status(500).json({ error: 'Failed to update availability' });
  }
});

module.exports = router;
