const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { recipientId, jobId, messageType = 'text', content, attachmentUrl } = req.body;

    if (!recipientId || !content) {
      return res.status(400).json({ error: 'Recipient ID and content required' });
    }

    if (!['text', 'image', 'file', 'location'].includes(messageType)) {
      return res.status(400).json({ error: 'Invalid message type' });
    }

    const recipientResult = await pool.query(
      'SELECT id FROM users WHERE id = $1 AND is_active = true',
      [recipientId]
    );

    if (recipientResult.rows.length === 0) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const result = await pool.query(
      `INSERT INTO messages (sender_id, recipient_id, job_id, message_type, content, attachment_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, recipientId, jobId, messageType, content, attachmentUrl]
    );

    const message = result.rows[0];

    req.newMessage = {
      ...message,
      sender_name: `${req.user.first_name} ${req.user.last_name}`
    };

    res.status(201).json({
      message: 'Message sent successfully',
      data: message
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

router.get('/conversation/:userId', authenticateToken, async (req, res) => {
  try {
    const otherUserId = req.params.userId;
    const { jobId, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        m.*,
        sender.first_name as sender_first_name,
        sender.last_name as sender_last_name,
        sender.profile_image_url as sender_image,
        recipient.first_name as recipient_first_name,
        recipient.last_name as recipient_last_name
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users recipient ON m.recipient_id = recipient.id
      WHERE ((m.sender_id = $1 AND m.recipient_id = $2) 
             OR (m.sender_id = $2 AND m.recipient_id = $1))
    `;

    const params = [req.user.id, otherUserId];

    if (jobId) {
      query += ' AND m.job_id = $3';
      params.push(jobId);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    await pool.query(
      'UPDATE messages SET is_read = true WHERE recipient_id = $1 AND sender_id = $2 AND is_read = false',
      [req.user.id, otherUserId]
    );

    res.json({ messages: result.rows.reverse() }); // Reverse to show oldest first
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT
        CASE 
          WHEN m.sender_id = $1 THEN m.recipient_id 
          ELSE m.sender_id 
        END as other_user_id,
        CASE 
          WHEN m.sender_id = $1 THEN recipient.first_name 
          ELSE sender.first_name 
        END as other_first_name,
        CASE 
          WHEN m.sender_id = $1 THEN recipient.last_name 
          ELSE sender.last_name 
        END as other_last_name,
        CASE 
          WHEN m.sender_id = $1 THEN recipient.profile_image_url 
          ELSE sender.profile_image_url 
        END as other_image,
        m.job_id,
        j.title as job_title,
        latest.content as last_message,
        latest.created_at as last_message_time,
        latest.message_type as last_message_type,
        unread.unread_count
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users recipient ON m.recipient_id = recipient.id
      LEFT JOIN jobs j ON m.job_id = j.id
      JOIN LATERAL (
        SELECT content, created_at, message_type
        FROM messages m2
        WHERE ((m2.sender_id = $1 AND m2.recipient_id = CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END)
               OR (m2.recipient_id = $1 AND m2.sender_id = CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END))
        AND (m2.job_id = m.job_id OR (m2.job_id IS NULL AND m.job_id IS NULL))
        ORDER BY m2.created_at DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*) as unread_count
        FROM messages m3
        WHERE m3.recipient_id = $1 
        AND m3.sender_id = CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END
        AND m3.is_read = false
        AND (m3.job_id = m.job_id OR (m3.job_id IS NULL AND m.job_id IS NULL))
      ) unread ON true
      WHERE m.sender_id = $1 OR m.recipient_id = $1
      ORDER BY latest.created_at DESC`,
      [req.user.id]
    );

    res.json({ conversations: result.rows });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ error: 'Failed to get conversations' });
  }
});

router.put('/mark-read', authenticateToken, async (req, res) => {
  try {
    const { senderId, jobId } = req.body;

    if (!senderId) {
      return res.status(400).json({ error: 'Sender ID required' });
    }

    let query = 'UPDATE messages SET is_read = true WHERE recipient_id = $1 AND sender_id = $2';
    const params = [req.user.id, senderId];

    if (jobId) {
      query += ' AND job_id = $3';
      params.push(jobId);
    }

    const result = await pool.query(query, params);

    res.json({ 
      message: 'Messages marked as read',
      updated: result.rowCount
    });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark messages as read' });
  }
});

router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) as unread_count FROM messages WHERE recipient_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({ unreadCount: parseInt(result.rows[0].unread_count) });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const messageId = req.params.id;

    const result = await pool.query(
      'DELETE FROM messages WHERE id = $1 AND sender_id = $2 RETURNING id',
      [messageId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or unauthorized' });
    }

    res.json({ message: 'Message deleted successfully' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

router.get('/search', authenticateToken, async (req, res) => {
  try {
    const { query, jobId, limit = 20 } = req.query;

    if (!query) {
      return res.status(400).json({ error: 'Search query required' });
    }

    let searchQuery = `
      SELECT 
        m.*,
        sender.first_name as sender_first_name,
        sender.last_name as sender_last_name,
        recipient.first_name as recipient_first_name,
        recipient.last_name as recipient_last_name,
        j.title as job_title
      FROM messages m
      JOIN users sender ON m.sender_id = sender.id
      JOIN users recipient ON m.recipient_id = recipient.id
      LEFT JOIN jobs j ON m.job_id = j.id
      WHERE (m.sender_id = $1 OR m.recipient_id = $1)
      AND m.content ILIKE $2
    `;

    const params = [req.user.id, `%${query}%`];

    if (jobId) {
      searchQuery += ' AND m.job_id = $3';
      params.push(jobId);
    }

    searchQuery += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(searchQuery, params);

    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({ error: 'Failed to search messages' });
  }
});

module.exports = router;
