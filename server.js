const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Simple test route
app.get('/', (req, res) => {
  res.json({
    message: 'StaffShield Pro API is running!',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Health check for Railway
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'StaffShield Pro' });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🛡️ StaffShield Pro running on port ${PORT}`);
});
