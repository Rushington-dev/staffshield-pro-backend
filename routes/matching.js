const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/jobs', authenticateToken, requireRole(['agent']), async (req, res) => {
  try {
    const { lat, lng, radius = 50, limit = 20 } = req.query;

    const agentResult = await pool.query(
      'SELECT * FROM agent_profiles WHERE user_id = $1',
      [req.user.id]
    );

    if (agentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Agent profile not found' });
    }

    const agent = agentResult.rows[0];

    let query = `
      SELECT 
        j.*,
        u.first_name as client_first_name,
        u.last_name as client_last_name,
        cp.company_name as client_company,
        (
          -- Base score
          100 +
          -- Distance score (closer = higher score)
          CASE 
            WHEN j.location_lat IS NOT NULL AND j.location_lng IS NOT NULL 
            THEN (50 - LEAST(50, (
              6371 * acos(
                cos(radians($2)) * cos(radians(j.location_lat)) *
                cos(radians(j.location_lng) - radians($3)) +
                sin(radians($2)) * sin(radians(j.location_lat))
              )
            ))) 
            ELSE 0 
          END +
          -- Rate match score
          CASE 
            WHEN j.hourly_rate >= $4 THEN 30
            WHEN j.hourly_rate >= ($4 * 0.8) THEN 20
            WHEN j.hourly_rate >= ($4 * 0.6) THEN 10
            ELSE 0
          END +
          -- Certification match score
          CASE 
            WHEN j.required_certifications IS NULL OR array_length(j.required_certifications, 1) IS NULL THEN 20
            WHEN j.required_certifications && $5 THEN 40
            ELSE 0
          END +
          -- Urgency bonus
          CASE j.urgency_level
            WHEN 'urgent' THEN 20
            WHEN 'high' THEN 15
            WHEN 'normal' THEN 10
            ELSE 5
          END +
          -- Experience bonus
          CASE 
            WHEN $6 >= 5 THEN 15
            WHEN $6 >= 2 THEN 10
            WHEN $6 >= 1 THEN 5
            ELSE 0
          END
        ) as match_score
      FROM jobs j
      JOIN users u ON j.client_id = u.id
      LEFT JOIN client_profiles cp ON u.id = cp.user_id
      WHERE j.status = 'open'
      AND j.start_date > CURRENT_TIMESTAMP
      AND j.id NOT IN (
        SELECT job_id FROM job_assignments WHERE agent_id = $1
      )
    `;

    const params = [
      req.user.id,
      lat || agent.location_lat || 0,
      lng || agent.location_lng || 0,
      agent.hourly_rate || 0,
      agent.certifications || [],
      agent.experience_years || 0
    ];

    if (lat && lng && radius) {
      query += ` AND (
        6371 * acos(
          cos(radians($2)) * cos(radians(j.location_lat)) *
          cos(radians(j.location_lng) - radians($3)) +
          sin(radians($2)) * sin(radians(j.location_lat))
        )
      ) <= ${radius}`;
    }

    query += ` ORDER BY match_score DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    const jobsWithReasons = result.rows.map(job => {
      const reasons = [];
      
      if (job.match_score >= 150) reasons.push('High overall match');
      if (job.hourly_rate >= (agent.hourly_rate || 0)) reasons.push('Good pay rate');
      if (job.required_certifications && agent.certifications && 
          job.required_certifications.some(cert => agent.certifications.includes(cert))) {
        reasons.push('Certification match');
      }
      if (job.urgency_level === 'urgent') reasons.push('Urgent job');
      if (lat && lng && job.location_lat && job.location_lng) {
        const distance = 6371 * Math.acos(
          Math.cos(lat * Math.PI / 180) * Math.cos(job.location_lat * Math.PI / 180) *
          Math.cos((job.location_lng - lng) * Math.PI / 180) +
          Math.sin(lat * Math.PI / 180) * Math.sin(job.location_lat * Math.PI / 180)
        );
        if (distance <= 10) reasons.push('Very close location');
        else if (distance <= 25) reasons.push('Close location');
      }

      return {
        ...job,
        match_reasons: reasons
      };
    });

    res.json({ jobs: jobsWithReasons });
  } catch (error) {
    console.error('Job matching error:', error);
    res.status(500).json({ error: 'Failed to get job matches' });
  }
});

router.get('/agents/:jobId', authenticateToken, requireRole(['ppo', 'client']), async (req, res) => {
  try {
    const jobId = req.params.jobId;

    const jobResult = await pool.query(
      'SELECT * FROM jobs WHERE id = $1',
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = jobResult.rows[0];

    if (req.user.user_type === 'client' && job.client_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (req.user.user_type === 'ppo' && job.ppo_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    let query = `
      SELECT 
        u.id, u.first_name, u.last_name, u.profile_image_url,
        ap.*,
        (
          -- Base score
          100 +
          -- Distance score
          CASE 
            WHEN ap.location_lat IS NOT NULL AND ap.location_lng IS NOT NULL 
            THEN (50 - LEAST(50, (
              6371 * acos(
                cos(radians($2)) * cos(radians(ap.location_lat)) *
                cos(radians(ap.location_lng) - radians($3)) +
                sin(radians($2)) * sin(radians(ap.location_lat))
              )
            ))) 
            ELSE 0 
          END +
          -- Rate compatibility score
          CASE 
            WHEN ap.hourly_rate <= $4 THEN 30
            WHEN ap.hourly_rate <= ($4 * 1.2) THEN 20
            WHEN ap.hourly_rate <= ($4 * 1.5) THEN 10
            ELSE 0
          END +
          -- Certification match score
          CASE 
            WHEN $5 IS NULL OR array_length($5, 1) IS NULL THEN 20
            WHEN ap.certifications && $5 THEN 40
            ELSE 0
          END +
          -- Rating bonus
          CASE 
            WHEN ap.rating >= 4.5 THEN 20
            WHEN ap.rating >= 4.0 THEN 15
            WHEN ap.rating >= 3.5 THEN 10
            ELSE 0
          END +
          -- Experience bonus
          CASE 
            WHEN ap.experience_years >= 5 THEN 15
            WHEN ap.experience_years >= 2 THEN 10
            WHEN ap.experience_years >= 1 THEN 5
            ELSE 0
          END +
          -- Availability bonus
          CASE ap.availability_status
            WHEN 'available' THEN 20
            WHEN 'busy' THEN 5
            ELSE 0
          END
        ) as match_score
      FROM users u
      JOIN agent_profiles ap ON u.id = ap.user_id
      WHERE u.user_type = 'agent' 
      AND u.is_active = true
      AND ap.background_check_status = 'approved'
      AND u.id NOT IN (
        SELECT agent_id FROM job_assignments 
        WHERE job_id = $1 AND status NOT IN ('declined', 'no_show')
      )
      AND NOT EXISTS (
        SELECT 1 FROM job_assignments ja2
        JOIN jobs j2 ON ja2.job_id = j2.id
        WHERE ja2.agent_id = u.id
        AND j2.start_date < $7
        AND j2.end_date > $6
        AND ja2.status IN ('assigned', 'accepted')
      )
    `;

    const params = [
      jobId,
      job.location_lat || 0,
      job.location_lng || 0,
      job.hourly_rate,
      job.required_certifications,
      job.start_date,
      job.end_date
    ];

    query += ' ORDER BY match_score DESC LIMIT 50';

    const result = await pool.query(query, params);

    const agentsWithReasons = result.rows.map(agent => {
      const reasons = [];
      
      if (agent.match_score >= 150) reasons.push('Excellent match');
      if (agent.rating >= 4.5) reasons.push('Top rated');
      if (agent.hourly_rate <= job.hourly_rate) reasons.push('Rate compatible');
      if (job.required_certifications && agent.certifications && 
          job.required_certifications.every(cert => agent.certifications.includes(cert))) {
        reasons.push('All certifications match');
      }
      if (agent.availability_status === 'available') reasons.push('Currently available');
      if (agent.experience_years >= 5) reasons.push('Highly experienced');

      return {
        ...agent,
        match_reasons: reasons
      };
    });

    res.json({ agents: agentsWithReasons });
  } catch (error) {
    console.error('Agent matching error:', error);
    res.status(500).json({ error: 'Failed to get agent matches' });
  }
});

router.get('/stats', authenticateToken, async (req, res) => {
  try {
    let stats = {};

    if (req.user.user_type === 'agent') {
      const result = await pool.query(
        `SELECT 
          COUNT(CASE WHEN j.status = 'open' THEN 1 END) as available_jobs,
          COUNT(CASE WHEN j.urgency_level = 'urgent' THEN 1 END) as urgent_jobs,
          AVG(j.hourly_rate) as avg_hourly_rate,
          COUNT(CASE WHEN ja.agent_id = $1 THEN 1 END) as applied_jobs
        FROM jobs j
        LEFT JOIN job_assignments ja ON j.id = ja.job_id
        WHERE j.start_date > CURRENT_TIMESTAMP`,
        [req.user.id]
      );
      stats = result.rows[0];
    } else if (req.user.user_type === 'ppo') {
      const result = await pool.query(
        `SELECT 
          COUNT(CASE WHEN u.user_type = 'agent' AND ap.availability_status = 'available' THEN 1 END) as available_agents,
          COUNT(CASE WHEN u.user_type = 'agent' AND ap.background_check_status = 'approved' THEN 1 END) as approved_agents,
          AVG(ap.hourly_rate) as avg_agent_rate,
          AVG(ap.rating) as avg_agent_rating
        FROM users u
        LEFT JOIN agent_profiles ap ON u.id = ap.user_id
        WHERE u.is_active = true`,
        []
      );
      stats = result.rows[0];
    } else if (req.user.user_type === 'client') {
      const result = await pool.query(
        `SELECT 
          COUNT(CASE WHEN j.client_id = $1 AND j.status = 'open' THEN 1 END) as open_jobs,
          COUNT(CASE WHEN j.client_id = $1 AND j.status = 'completed' THEN 1 END) as completed_jobs,
          COUNT(CASE WHEN u.user_type = 'ppo' THEN 1 END) as available_ppos,
          AVG(CASE WHEN j.client_id = $1 THEN j.hourly_rate END) as avg_job_rate
        FROM jobs j
        CROSS JOIN users u
        WHERE u.user_type = 'ppo' AND u.is_active = true`,
        [req.user.id]
      );
      stats = result.rows[0];
    }

    res.json({ stats });
  } catch (error) {
    console.error('Get matching stats error:', error);
    res.status(500).json({ error: 'Failed to get matching statistics' });
  }
});

router.post('/preferences', authenticateToken, requireRole(['agent']), async (req, res) => {
  try {
    const { jobId, interested } = req.body;

    if (!jobId || typeof interested !== 'boolean') {
      return res.status(400).json({ error: 'Job ID and interested flag required' });
    }

    if (interested) {
      await pool.query(
        `INSERT INTO job_assignments (job_id, agent_id, status) 
         VALUES ($1, $2, 'interested') 
         ON CONFLICT (job_id, agent_id) DO UPDATE SET status = 'interested'`,
        [jobId, req.user.id]
      );
    } else {
      await pool.query(
        'DELETE FROM job_assignments WHERE job_id = $1 AND agent_id = $2 AND status = $3',
        [jobId, req.user.id, 'interested']
      );
    }

    res.json({ message: 'Preference saved successfully' });
  } catch (error) {
    console.error('Save preference error:', error);
    res.status(500).json({ error: 'Failed to save preference' });
  }
});

module.exports = router;
