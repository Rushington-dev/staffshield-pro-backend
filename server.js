const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// THIS IS A TEMPORARY PLACEHOLDER until the database is connected
const pool = {
  query: () => {
    console.warn("Database is not connected. Using placeholder data.");
    return Promise.resolve({ rows: [] });
  },
  connect: () => {
    console.warn("Database is not connected. Using placeholder connection.");
    return Promise.resolve({ release: () => {} });
  }
};

// Security middleware
app.use(helmet());
app.use(compression());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});
app.use(limiter);

// CORS configuration
app.use(cors({ origin: "*", credentials: true }));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// A function to initialize the database (we will call this later)
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    console.log('✅ StaffShield Pro connected to PostgreSQL');
    // ... Database table creation would go here ...
    client.release();
    console.log('✅ Database tables checked/initialized.');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    platform: 'StaffShield Pro',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: 'Disconnected (Running in Test Mode)',
  });
});

// --- All your other API routes like /api/auth/login etc. would go here ---
// --- For now, we'll keep it simple to ensure it deploys ---


// Socket.io for real-time features
io.on('connection', (socket) => {
  console.log('🔌 StaffShield Pro: User connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    platform: 'StaffShield Pro'
  });
});

// Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // IMPORTANT: We are NOT calling initializeDatabase() yet.
    // We will add this back once the database is configured in Railway.
    // await initializeDatabase();

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🛡️  StaffShield Pro Backend running on port ${PORT}`);
      console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start StaffShield Pro server:', error);
    process.exit(1);
  }
}

startServer();

// NOTE: The extra app.listen() that was at the end of the file has been removed.
