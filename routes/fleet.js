const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/vehicles', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const {
      make, model, year, licensePlate, vin, color, vehicleType,
      dailyRate, insurancePolicy, registrationExpiry
    } = req.body;

    if (!make || !model || !year || !licensePlate || !vehicleType) {
      return res.status(400).json({ error: 'Missing required vehicle fields' });
    }

    const result = await pool.query(
      `INSERT INTO fleet_vehicles (
        ppo_id, make, model, year, license_plate, vin, color, 
        vehicle_type, daily_rate, insurance_policy, registration_expiry
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        req.user.id, make, model, year, licensePlate, vin, color,
        vehicleType, dailyRate, insurancePolicy, registrationExpiry
      ]
    );

    res.status(201).json({
      message: 'Vehicle added successfully',
      vehicle: result.rows[0]
    });
  } catch (error) {
    console.error('Add vehicle error:', error);
    res.status(500).json({ error: 'Failed to add vehicle' });
  }
});

router.get('/vehicles', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const { status } = req.query;

    let query = 'SELECT * FROM fleet_vehicles WHERE ppo_id = $1';
    const params = [req.user.id];

    if (status) {
      query += ' AND status = $2';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ vehicles: result.rows });
  } catch (error) {
    console.error('Get vehicles error:', error);
    res.status(500).json({ error: 'Failed to get vehicles' });
  }
});

router.get('/vehicles/available', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'Start date and end date required' });
    }

    const result = await pool.query(
      `SELECT fv.* FROM fleet_vehicles fv
       WHERE fv.ppo_id = $1 AND fv.status = 'available'
       AND fv.id NOT IN (
         SELECT va.vehicle_id FROM vehicle_assignments va
         JOIN jobs j ON va.job_id = j.id
         WHERE j.start_date < $3 AND j.end_date > $2
         AND va.returned_at IS NULL
       )
       ORDER BY fv.daily_rate ASC`,
      [req.user.id, startDate, endDate]
    );

    res.json({ vehicles: result.rows });
  } catch (error) {
    console.error('Get available vehicles error:', error);
    res.status(500).json({ error: 'Failed to get available vehicles' });
  }
});

router.put('/vehicles/:id', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const vehicleId = req.params.id;
    const {
      make, model, year, licensePlate, vin, color, vehicleType,
      status, dailyRate, insurancePolicy, registrationExpiry
    } = req.body;

    const vehicleResult = await pool.query(
      'SELECT id FROM fleet_vehicles WHERE id = $1 AND ppo_id = $2',
      [vehicleId, req.user.id]
    );

    if (vehicleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found or unauthorized' });
    }

    await pool.query(
      `UPDATE fleet_vehicles SET 
       make = $1, model = $2, year = $3, license_plate = $4, vin = $5,
       color = $6, vehicle_type = $7, status = $8, daily_rate = $9,
       insurance_policy = $10, registration_expiry = $11
       WHERE id = $12`,
      [
        make, model, year, licensePlate, vin, color, vehicleType,
        status, dailyRate, insurancePolicy, registrationExpiry, vehicleId
      ]
    );

    res.json({ message: 'Vehicle updated successfully' });
  } catch (error) {
    console.error('Update vehicle error:', error);
    res.status(500).json({ error: 'Failed to update vehicle' });
  }
});

router.post('/vehicles/:id/assign', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const vehicleId = req.params.id;
    const { jobId, agentId, mileageStart, fuelLevelStart } = req.body;

    if (!jobId || !agentId) {
      return res.status(400).json({ error: 'Job ID and agent ID required' });
    }

    const vehicleResult = await pool.query(
      'SELECT id FROM fleet_vehicles WHERE id = $1 AND ppo_id = $2 AND status = $3',
      [vehicleId, req.user.id, 'available']
    );

    if (vehicleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found, unauthorized, or not available' });
    }

    const jobResult = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND ppo_id = $2',
      [jobId, req.user.id]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or unauthorized' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO vehicle_assignments (
          vehicle_id, job_id, agent_id, mileage_start, fuel_level_start
        ) VALUES ($1, $2, $3, $4, $5)`,
        [vehicleId, jobId, agentId, mileageStart, fuelLevelStart]
      );

      await client.query(
        'UPDATE fleet_vehicles SET status = $1 WHERE id = $2',
        ['assigned', vehicleId]
      );

      await client.query('COMMIT');
      res.json({ message: 'Vehicle assigned successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Assign vehicle error:', error);
    res.status(500).json({ error: 'Failed to assign vehicle' });
  }
});

router.post('/vehicles/:id/return', authenticateToken, requireRole(['ppo', 'agent']), async (req, res) => {
  try {
    const vehicleId = req.params.id;
    const { mileageEnd, fuelLevelEnd, conditionNotes } = req.body;

    let assignmentQuery;
    if (req.user.user_type === 'ppo') {
      assignmentQuery = `
        SELECT va.* FROM vehicle_assignments va
        JOIN fleet_vehicles fv ON va.vehicle_id = fv.id
        WHERE va.vehicle_id = $1 AND fv.ppo_id = $2 AND va.returned_at IS NULL
      `;
    } else {
      assignmentQuery = `
        SELECT * FROM vehicle_assignments 
        WHERE vehicle_id = $1 AND agent_id = $2 AND returned_at IS NULL
      `;
    }

    const assignmentResult = await pool.query(assignmentQuery, [vehicleId, req.user.id]);

    if (assignmentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Active vehicle assignment not found' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE vehicle_assignments SET 
         returned_at = CURRENT_TIMESTAMP, mileage_end = $1, 
         fuel_level_end = $2, condition_notes = $3
         WHERE id = $4`,
        [mileageEnd, fuelLevelEnd, conditionNotes, assignmentResult.rows[0].id]
      );

      await client.query(
        'UPDATE fleet_vehicles SET status = $1 WHERE id = $2',
        ['available', vehicleId]
      );

      await client.query('COMMIT');
      res.json({ message: 'Vehicle returned successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Return vehicle error:', error);
    res.status(500).json({ error: 'Failed to return vehicle' });
  }
});

router.get('/assignments', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const { active } = req.query;

    let query = `
      SELECT 
        va.*, 
        fv.make, fv.model, fv.year, fv.license_plate,
        j.title as job_title, j.start_date, j.end_date,
        u.first_name, u.last_name
      FROM vehicle_assignments va
      JOIN fleet_vehicles fv ON va.vehicle_id = fv.id
      JOIN jobs j ON va.job_id = j.id
      JOIN users u ON va.agent_id = u.id
      WHERE fv.ppo_id = $1
    `;

    const params = [req.user.id];

    if (active === 'true') {
      query += ' AND va.returned_at IS NULL';
    }

    query += ' ORDER BY va.assigned_at DESC';

    const result = await pool.query(query, params);
    res.json({ assignments: result.rows });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ error: 'Failed to get assignments' });
  }
});

module.exports = router;
