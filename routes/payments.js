const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../config/database');
const { authenticateToken, requireRole } = require('../middleware/auth');

const router = express.Router();

router.post('/create-intent', authenticateToken, requireRole(['client']), async (req, res) => {
  try {
    const { jobId, amount } = req.body;

    if (!jobId || !amount) {
      return res.status(400).json({ error: 'Job ID and amount required' });
    }

    const jobResult = await pool.query(
      'SELECT id, title FROM jobs WHERE id = $1 AND client_id = $2',
      [jobId, req.user.id]
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or unauthorized' });
    }

    const job = jobResult.rows[0];

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      metadata: {
        jobId: jobId.toString(),
        clientId: req.user.id.toString(),
        jobTitle: job.title
      }
    });

    await pool.query(
      `INSERT INTO payments (job_id, payer_id, amount, stripe_payment_intent_id, payment_type, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [jobId, req.user.id, amount, paymentIntent.id, 'job_payment', 'pending']
    );

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        
        await pool.query(
          'UPDATE payments SET status = $1, processed_at = CURRENT_TIMESTAMP WHERE stripe_payment_intent_id = $2',
          ['completed', paymentIntent.id]
        );

        const jobId = paymentIntent.metadata.jobId;
        if (jobId) {
          await pool.query(
            'UPDATE jobs SET status = $1 WHERE id = $2 AND status = $3',
            ['assigned', jobId, 'open']
          );
        }
        break;

      case 'payment_intent.payment_failed':
        const failedPayment = event.data.object;
        
        await pool.query(
          'UPDATE payments SET status = $1 WHERE stripe_payment_intent_id = $2',
          ['failed', failedPayment.id]
        );
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        p.*, 
        j.title as job_title,
        payer.first_name as payer_first_name,
        payer.last_name as payer_last_name,
        payee.first_name as payee_first_name,
        payee.last_name as payee_last_name
      FROM payments p
      LEFT JOIN jobs j ON p.job_id = j.id
      LEFT JOIN users payer ON p.payer_id = payer.id
      LEFT JOIN users payee ON p.payee_id = payee.id
      WHERE p.payer_id = $1 OR p.payee_id = $1
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [req.user.id, limit, offset]);
    res.json({ payments: result.rows });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({ error: 'Failed to get payment history' });
  }
});

router.post('/payout', authenticateToken, requireRole(['client', 'admin']), async (req, res) => {
  try {
    const { jobId, payeeId, amount } = req.body;

    if (!jobId || !payeeId || !amount) {
      return res.status(400).json({ error: 'Job ID, payee ID, and amount required' });
    }

    const jobResult = await pool.query(
      'SELECT id, status FROM jobs WHERE id = $1 AND (client_id = $2 OR $3 = true)',
      [jobId, req.user.id, req.user.user_type === 'admin']
    );

    if (jobResult.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found or unauthorized' });
    }

    const job = jobResult.rows[0];
    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'Job must be completed before payout' });
    }

    await pool.query(
      `INSERT INTO payments (job_id, payer_id, payee_id, amount, payment_type, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [jobId, req.user.id, payeeId, amount, 'job_payment', 'completed']
    );

    res.json({ message: 'Payout processed successfully' });
  } catch (error) {
    console.error('Process payout error:', error);
    res.status(500).json({ error: 'Failed to process payout' });
  }
});

router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_payments,
        SUM(CASE WHEN payer_id = $1 THEN amount ELSE 0 END) as total_paid,
        SUM(CASE WHEN payee_id = $1 THEN amount ELSE 0 END) as total_received,
        SUM(CASE WHEN payer_id = $1 AND status = 'pending' THEN amount ELSE 0 END) as pending_payments
      FROM payments 
      WHERE payer_id = $1 OR payee_id = $1`,
      [req.user.id]
    );

    res.json({ summary: result.rows[0] });
  } catch (error) {
    console.error('Get payment summary error:', error);
    res.status(500).json({ error: 'Failed to get payment summary' });
  }
});

module.exports = router;
