const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticateToken, requireRole(['client']), async (req, res) => {
  try {
    const {
      title, description, locationAddress, locationLat, locationLng,
      startDate, endDate, hourlyRate, agentsNeeded, requiredCertifications,
      specialRequirements, urgencyLevel, equipmentProvided, uniformRequired, vehicleRequired
    } = req.body;

    if (!title || !description || !locationAddress || !startDate || !endDate || !hourlyRate || !agentsNeeded) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(
      `INSERT INTO jobs (
        client_id, title, description, location_address, location_lat, location_lng,
        start_date, end_date, hourly_rate, agents_needed, required_certifications,
        special_requirements, urgency_level, equipment_provided, uniform_required, vehicle_required
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        req.user.id, title, description, locationAddress, locationLat, locationLng,
        startDate, endDate, hourlyRate, agentsNeeded, requiredCertifications,
        specialRequirements, urgencyLevel, equipmentProvided, uniformRequired, vehicleRequired
      ]
    );

    res.status(201).json({
      message: 'Job created successfully',
      job: result.rows[0]
    });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, urgency, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        j.*, 
        u.first_name as client_first_name, 
        u.last_name as client_last_name,
        cp.company_name as client_company
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      LEFT JOIN client_profiles cp ON u.id = cp.user_id
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    if (req.user.user_type === 'client') {
      paramCount++;
      query += ` AND j.client_id = $${paramCount}`;
      params.push(req.user.id);
    } else if (req.user.user_type === 'ppo') {
      paramCount++;
      query += ` AND (j.ppo_id = $${paramCount} OR j.ppo_id IS NULL)`;
      params.push(req.user.id);
    }

    if (status) {
      paramCount++;
      query += ` AND j.status = $${paramCount}`;
      params.push(status);
    }

    if (urgency) {
      paramCount++;
      query += ` AND j.urgency_level = $${paramCount}`;
      params.push(urgency);
    }

    query += ` ORDER BY j.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json({ jobs: result.rows });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const jobId = req.params.id;

    const result = await pool.query(
      `SELECT 
        j.*, 
        u.first_name as client_first_name, 
        u.last_name as client_last_name,
        cp.company_name as client_company
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      LEFT JOIN client_profiles cp ON u.id = cp.user_id
      WHERE j.id = $1`,
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const assignmentsResult = await pool.query(
      `SELECT 
        ja.*, 
        u.first_name, u.last_name, u.profile_image_url,
        ap.license_number, ap.rating
      FROM job_assignments ja
      JOIN users u ON ja.agent_id = u.id
      LEFT JOIN agent_profiles ap ON u.id = ap.user_id
      WHERE ja.job_id = $1`,
      [jobId]
    );

    const job = result.rows[0];
    job.assignments = assignmentsResult.rows;

    res.json({ job });
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

router.post('/:id/assign-ppo', authenticateToken, requireRole(['client']), async (req, res) => {
  try {
    const jobId = req.params.id;
    const { ppoId } = req.body;

    const jobResult = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND client_id = $2',
      [jobId, req.user.id]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or unauthorized' });
    }

    const ppoResult = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND user_type = $2',
      [ppoId, 'ppo']
    );

    if (ppoResult.rows.length === 0) {
      return res.status(404).json({ error: 'PPO not found' });
    }

    await pool.query(
      'UPDATE jobs SET ppo_id = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [ppoId, 'assigned', jobId]
    );

    res.json({ message: 'PPO assigned successfully' });
  } catch (error) {
    console.error('Assign PPO error:', error);
    res.status(500).json({ error: 'Failed to assign PPO' });
  }
});

router.post('/:id/assign-agents', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const jobId = req.params.id;
    const { agentIds } = req.body;

    if (!Array.isArray(agentIds) || agentIds.length === 0) {
      return res.status(400).json({ error: 'Agent IDs array required' });
    }

    const jobResult = await pool.query(
      'SELECT id, agents_needed FROM jobs WHERE id = $1 AND ppo_id = $2',
      [jobId, req.user.id]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or unauthorized' });
    }

    const job = jobResult.rows[0];

    if (agentIds.length > job.agents_needed) {
      return res.status(400).json({ error: 'Too many agents assigned' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query('DELETE FROM job_assignments WHERE job_id = $1', [jobId]);

      for (const agentId of agentIds) {
        await client.query(
          'INSERT INTO job_assignments (job_id, agent_id) VALUES ($1, $2)',
          [jobId, agentId]
        );
      }

      await client.query(
        'UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        ['in_progress', jobId]
      );

      await client.query('COMMIT');
      res.json({ message: 'Agents assigned successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Assign agents error:', error);
    res.status(500).json({ error: 'Failed to assign agents' });
  }
});

router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const jobId = req.params.id;
    const { status } = req.body;

    if (!['open', 'assigned', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    let authQuery;
    if (req.user.user_type === 'client') {
      authQuery = 'SELECT id FROM jobs WHERE id = $1 AND client_id = $2';
    } else if (req.user.user_type === 'ppo') {
      authQuery = 'SELECT id FROM jobs WHERE id = $1 AND ppo_id = $2';
    } else {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const authResult = await pool.query(authQuery, [jobId, req.user.id]);
    if (authResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or unauthorized' });
    }

    await pool.query(
      'UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, jobId]
    );

    res.json({ message: 'Job status updated successfully' });
  } catch (error) {
    console.error('Update job status error:', error);
    res.status(500).json({ error: 'Failed to update job status' });
  }
});

module.exports = router;
