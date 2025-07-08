const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/records', authenticateToken, async (req, res) => {
  try {
    const {
      recordType, status, issuedDate, expiryDate, 
      issuingAuthority, documentUrl, notes
    } = req.body;

    if (!recordType || !['background_check', 'drug_test', 'training', 'certification'].includes(recordType)) {
      return res.status(400).json({ error: 'Valid record type required' });
    }

    const result = await pool.query(
      `INSERT INTO compliance_records (
        user_id, record_type, status, issued_date, expiry_date,
        issuing_authority, document_url, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        req.user.id, recordType, status || 'pending', issuedDate, expiryDate,
        issuingAuthority, documentUrl, notes
      ]
    );

    res.status(201).json({
      message: 'Compliance record added successfully',
      record: result.rows[0]
    });
  } catch (error) {
    console.error('Add compliance record error:', error);
    res.status(500).json({ error: 'Failed to add compliance record' });
  }
});

router.get('/records', authenticateToken, async (req, res) => {
  try {
    const { recordType, status, userId } = req.query;

    let query = 'SELECT * FROM compliance_records WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (req.user.user_type !== 'admin' && !userId) {
      paramCount++;
      query += ` AND user_id = $${paramCount}`;
      params.push(req.user.id);
    } else if (userId && req.user.user_type === 'ppo') {
      paramCount++;
      query += ` AND user_id = $${paramCount}`;
      params.push(userId);
    }

    if (recordType) {
      paramCount++;
      query += ` AND record_type = $${paramCount}`;
      params.push(recordType);
    }

    if (status) {
      paramCount++;
      query += ` AND status = $${paramCount}`;
      params.push(status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await pool.query(query, params);
    res.json({ records: result.rows });
  } catch (error) {
    console.error('Get compliance records error:', error);
    res.status(500).json({ error: 'Failed to get compliance records' });
  }
});

router.put('/records/:id/status', authenticateToken, requireRole(['ppo', 'admin']), async (req, res) => {
  try {
    const recordId = req.params.id;
    const { status, notes } = req.body;

    if (!['pending', 'approved', 'rejected', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(
      'UPDATE compliance_records SET status = $1, notes = $2 WHERE id = $3 RETURNING *',
      [status, notes, recordId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Compliance record not found' });
    }

    if (result.rows[0].record_type === 'background_check') {
      await pool.query(
        'UPDATE agent_profiles SET background_check_status = $1, background_check_date = CURRENT_DATE WHERE user_id = $2',
        [status, result.rows[0].user_id]
      );
    }

    res.json({
      message: 'Compliance record status updated successfully',
      record: result.rows[0]
    });
  } catch (error) {
    console.error('Update compliance status error:', error);
    res.status(500).json({ error: 'Failed to update compliance status' });
  }
});

router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.query;
    const targetUserId = userId || req.user.id;

    if (targetUserId !== req.user.id && !['ppo', 'admin'].includes(req.user.user_type)) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT 
        record_type,
        status,
        COUNT(*) as count,
        MAX(expiry_date) as latest_expiry
      FROM compliance_records 
      WHERE user_id = $1 
      GROUP BY record_type, status
      ORDER BY record_type, status`,
      [targetUserId]
    );

    const expiringResult = await pool.query(
      `SELECT * FROM compliance_records 
       WHERE user_id = $1 AND expiry_date IS NOT NULL 
       AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
       AND expiry_date > CURRENT_DATE
       ORDER BY expiry_date ASC`,
      [targetUserId]
    );

    res.json({
      summary: result.rows,
      expiring: expiringResult.rows
    });
  } catch (error) {
    console.error('Get compliance summary error:', error);
    res.status(500).json({ error: 'Failed to get compliance summary' });
  }
});

router.get('/agents/issues', authenticateToken, requireRole(['ppo']), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT
        u.id, u.first_name, u.last_name, u.email,
        ap.background_check_status,
        COUNT(CASE WHEN cr.status = 'expired' THEN 1 END) as expired_records,
        COUNT(CASE WHEN cr.status = 'rejected' THEN 1 END) as rejected_records,
        COUNT(CASE WHEN cr.expiry_date <= CURRENT_DATE + INTERVAL '30 days' 
                   AND cr.expiry_date > CURRENT_DATE THEN 1 END) as expiring_records
      FROM users u
      JOIN agent_profiles ap ON u.id = ap.user_id
      LEFT JOIN compliance_records cr ON u.id = cr.user_id
      WHERE u.user_type = 'agent'
      AND (ap.background_check_status != 'approved' 
           OR cr.status IN ('expired', 'rejected')
           OR (cr.expiry_date <= CURRENT_DATE + INTERVAL '30 days' 
               AND cr.expiry_date > CURRENT_DATE))
      GROUP BY u.id, u.first_name, u.last_name, u.email, ap.background_check_status
      ORDER BY expired_records DESC, rejected_records DESC, expiring_records DESC`,
      []
    );

    res.json({ agents: result.rows });
  } catch (error) {
    console.error('Get compliance issues error:', error);
    res.status(500).json({ error: 'Failed to get compliance issues' });
  }
});

router.post('/records/bulk-update', authenticateToken, requireRole(['ppo', 'admin']), async (req, res) => {
  try {
    const { recordIds, status, notes } = req.body;

    if (!Array.isArray(recordIds) || recordIds.length === 0) {
      return res.status(400).json({ error: 'Record IDs array required' });
    }

    if (!['pending', 'approved', 'rejected', 'expired'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const placeholders = recordIds.map((_, index) => `$${index + 3}`).join(',');
      const result = await client.query(
        `UPDATE compliance_records 
         SET status = $1, notes = $2 
         WHERE id IN (${placeholders})
         RETURNING *`,
        [status, notes, ...recordIds]
      );

      const backgroundCheckRecords = result.rows.filter(r => r.record_type === 'background_check');
      for (const record of backgroundCheckRecords) {
        await client.query(
          'UPDATE agent_profiles SET background_check_status = $1, background_check_date = CURRENT_DATE WHERE user_id = $2',
          [status, record.user_id]
        );
      }

      await client.query('COMMIT');
      res.json({
        message: `${result.rows.length} compliance records updated successfully`,
        updated: result.rows.length
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Bulk update compliance error:', error);
    res.status(500).json({ error: 'Failed to bulk update compliance records' });
  }
});

module.exports = router;
