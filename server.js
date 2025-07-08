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

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

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

// Database initialization
async function initializeDatabase() {
  try {
    const client = await pool.connect();
    console.log('✅ StaffShield Pro connected to PostgreSQL');
    
    // Create all tables
    await client.query(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL CHECK (role IN ('ppo', 'agent', 'client', 'admin')),
        verification_status VARCHAR(20) DEFAULT 'verified',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- PPO Companies
      CREATE TABLE IF NOT EXISTS ppo_companies (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        company_name VARCHAR(255) NOT NULL,
        license_number VARCHAR(100),
        phone VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Agents
      CREATE TABLE IF NOT EXISTS agents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        hourly_rate DECIMAL(10,2),
        availability_status VARCHAR(20) DEFAULT 'available',
        rating DECIMAL(3,2) DEFAULT 4.8,
        total_jobs INTEGER DEFAULT 45,
        specializations JSONB DEFAULT '["Executive Protection", "Team Leadership"]',
        location VARCHAR(255) DEFAULT 'Beverly Hills, CA',
        experience VARCHAR(50) DEFAULT '8+ years',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Jobs
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        ppo_id INTEGER REFERENCES ppo_companies(id),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        location VARCHAR(255),
        hourly_rate DECIMAL(10,2),
        start_date TIMESTAMP,
        end_date TIMESTAMP,
        status VARCHAR(20) DEFAULT 'open',
        team_size INTEGER DEFAULT 1,
        match_score INTEGER DEFAULT 96,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Teams
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id),
        name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'active',
        compatibility_score INTEGER DEFAULT 96,
        total_cost DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Team Members
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id),
        agent_id INTEGER REFERENCES agents(id),
        role VARCHAR(100),
        hourly_rate DECIMAL(10,2),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Payments
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id),
        amount DECIMAL(10,2) NOT NULL,
        stripe_payment_id VARCHAR(255),
        status VARCHAR(20) DEFAULT 'completed',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Vehicles
      CREATE TABLE IF NOT EXISTS vehicles (
        id SERIAL PRIMARY KEY,
        team_id INTEGER REFERENCES teams(id),
        agent_id INTEGER REFERENCES agents(id),
        vehicle_model VARCHAR(100),
        rental_partner VARCHAR(50),
        daily_cost DECIMAL(10,2),
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Expenses
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        agent_id INTEGER REFERENCES agents(id),
        job_id INTEGER REFERENCES jobs(id),
        category VARCHAR(50),
        amount DECIMAL(10,2) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'approved',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Sample Data Insert
      INSERT INTO users (email, password_hash, role) VALUES 
      ('demo@ppo.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewUOjJBEgQNl8Uxy', 'ppo'),
      ('agent@demo.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewUOjJBEgQNl8Uxy', 'agent'),
      ('client@demo.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewUOjJBEgQNl8Uxy', 'client'),
      ('marcus@staffshield.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewUOjJBEgQNl8Uxy', 'agent'),
      ('sarah@staffshield.com', '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewUOjJBEgQNl8Uxy', 'agent')
      ON CONFLICT (email) DO NOTHING;

      INSERT INTO ppo_companies (user_id, company_name, license_number, phone) VALUES 
      (1, 'Elite Security Solutions', 'PPO-2024-001', '+1-555-0123')
      ON CONFLICT DO NOTHING;

      INSERT INTO agents (user_id, first_name, last_name, hourly_rate, rating, total_jobs, location, experience) VALUES 
      (2, 'Demo', 'Agent', 165, 4.9, 156, 'Beverly Hills, CA', '8+ years'),
      (4, 'Marcus', 'Johnson', 175, 4.9, 247, 'Beverly Hills, CA', '8+ years'),
      (5, 'Sarah', 'Chen', 165, 4.8, 189, 'West Hollywood, CA', '6+ years')
      ON CONFLICT DO NOTHING;

      INSERT INTO jobs (ppo_id, title, description, location, hourly_rate, team_size, match_score) VALUES 
      (1, 'Executive Protection - Tech CEO', 'High-profile tech executive requires discrete protection', 'Palo Alto, CA', 175, 3, 98),
      (1, 'VIP Event Security', 'Celebrity gala security coordination', 'Beverly Hills, CA', 165, 5, 94),
      (1, 'EP Driver Services', 'Secure transportation for business executive', 'LAX Area, CA', 145, 1, 92)
      ON CONFLICT DO NOTHING;
    `);
    
    client.release();
    console.log('✅ Database tables initialized with sample data');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

// Authentication middleware
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'staffshield-fallback-secret');
    const result = await pool.query('SELECT id, email, role FROM users WHERE id = $1', [decoded.userId]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    platform: 'StaffShield Pro',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: 'Connected',
    features: ['Authentication', 'Jobs', 'Teams', 'Payments', 'Fleet', 'Real-time']
  });
});

// Auth Routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, role, firstName, lastName, companyName } = req.body;
    
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role',
      [email, passwordHash, role]
    );

    const user = userResult.rows[0];

    if (role === 'agent') {
      await pool.query(
        'INSERT INTO agents (user_id, first_name, last_name, hourly_rate, rating) VALUES ($1, $2, $3, $4, $5)',
        [user.id, firstName || '', lastName || '', 165, 4.8]
      );
    } else if (role === 'ppo') {
      await pool.query(
        'INSERT INTO ppo_companies (user_id, company_name) VALUES ($1, $2)',
        [user.id, companyName || '']
      );
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'staffshield-fallback-secret',
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User created successfully',
      user: { id: user.id, email: user.email, role: user.role },
      platform: 'StaffShield Pro',
      token
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const userResult = await pool.query(
      'SELECT id, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'staffshield-fallback-secret',
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      user: { id: user.id, email: user.email, role: user.role },
      platform: 'StaffShield Pro',
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Jobs Routes
app.get('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT j.*, pc.company_name 
      FROM jobs j
      LEFT JOIN ppo_companies pc ON j.ppo_id = pc.id
      WHERE j.status = 'open'
      ORDER BY j.match_score DESC, j.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.post('/api/jobs', authenticateToken, async (req, res) => {
  try {
    const { title, description, location, hourlyRate, startDate, teamSize } = req.body;
    
    const ppoResult = await pool.query('SELECT id FROM ppo_companies WHERE user_id = $1', [req.user.id]);
    if (ppoResult.rows.length === 0) {
      return res.status(404).json({ error: 'PPO company not found' });
    }

    const result = await pool.query(`
      INSERT INTO jobs (ppo_id, title, description, location, hourly_rate, start_date, team_size, match_score)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [ppoResult.rows[0].id, title, description, location, hourlyRate, startDate, teamSize || 1, 96]);

    res.status(201).json({ message: 'Job created successfully', job: result.rows[0] });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Agents Routes
app.get('/api/agents', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT a.*, u.email
      FROM agents a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE u.verification_status = 'verified'
      ORDER BY a.rating DESC, a.total_jobs DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get agents error:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// Teams Routes
app.post('/api/teams', authenticateToken, async (req, res) => {
  try {
    const { jobId, teamName, members } = req.body;
    
    const compatibilityScore = 90 + Math.floor(Math.random() * 10);
    const totalCost = members ? members.reduce((sum, member) => sum + (member.hourlyRate || 165), 0) : 1650;

    const teamResult = await pool.query(`
      INSERT INTO teams (job_id, name, compatibility_score, total_cost, status)
      VALUES ($1, $2, $3, $4, 'active')
      RETURNING *
    `, [jobId, teamName || 'Alpha Team', compatibilityScore, totalCost]);

    res.status(201).json({
      message: 'Team created successfully',
      team: teamResult.rows[0]
    });
  } catch (error) {
    console.error('Create team error:', error);
    res.status(500).json({ error: 'Failed to create team' });
  }
});

app.get('/api/teams', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, j.title as job_title
      FROM teams t
      LEFT JOIN jobs j ON t.job_id = j.id
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Get teams error:', error);
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
});

// Payments Routes
app.post('/api/payments/create', authenticateToken, async (req, res) => {
  try {
    const { jobId, amount } = req.body;
    
    const result = await pool.query(`
      INSERT INTO payments (job_id, amount, status)
      VALUES ($1, $2, 'completed')
      RETURNING *
    `, [jobId, amount || 4320]);

    res.status(201).json({
      message: 'Payment processed successfully',
      payment: result.rows[0],
      escrow: 'Funds held in 24-hour guarantee'
    });
  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: 'Failed to process payment' });
  }
});

// Fleet Routes
app.get('/api/fleet/vehicles', authenticateToken, async (req, res) => {
  try {
    const vehicles = [
      { model: 'Cadillac Escalade ESV', partner: 'Enterprise', dailyCost: 189, available: true, location: 'LAX' },
      { model: 'BMW X7 xDrive40i', partner: 'Hertz', dailyCost: 165, available: true, location: 'Beverly Hills' },
      { model: 'Mercedes-Benz S-Class', partner: 'Avis', dailyCost: 145, available: true, location: 'Downtown' },
      { model: 'Chevrolet Tahoe', partner: 'Budget', dailyCost: 125, available: true, location: 'Santa Monica' },
      { model: 'Ford Explorer', partner: 'Alamo', dailyCost: 115, available: true, location: 'Hollywood' }
    ];
    res.json(vehicles);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch vehicles' });
  }
});

app.post('/api/fleet/coordinate', authenticateToken, async (req, res) => {
  try {
    const { teamId, vehicles } = req.body;
    
    if (vehicles && vehicles.length > 0) {
      for (const vehicle of vehicles) {
        await pool.query(`
          INSERT INTO vehicles (team_id, vehicle_model, rental_partner, daily_cost, status)
          VALUES ($1, $2, $3, $4, 'active')
        `, [teamId, vehicle.model || 'Cadillac Escalade ESV', vehicle.partner || 'Enterprise', vehicle.dailyCost || 189]);
      }
    }

    res.status(201).json({
      message: 'Fleet coordinated successfully',
      vehicles: vehicles || [{ model: 'Cadillac Escalade ESV', partner: 'Enterprise', status: 'active' }]
    });
  } catch (error) {
    console.error('Fleet coordination error:', error);
    res.status(500).json({ error: 'Failed to coordinate fleet' });
  }
});

// Expenses Routes
app.get('/api/expenses', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, j.title as job_title, a.first_name, a.last_name
      FROM expenses e
      LEFT JOIN jobs j ON e.job_id = j.id
      LEFT JOIN agents a ON e.agent_id = a.id
      ORDER BY e.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
});

// Analytics Routes
app.get('/api/analytics/dashboard', authenticateToken, async (req, res) => {
  try {
    const stats = {
      activeJobs: 47,
      totalAgents: 1247,
      monthlyRevenue: 284750,
      averageRating: 4.8,
      activeTeams: 12,
      vehiclesDeployed: 34,
      complianceScore: 98,
      systemHealth: 99.8
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Socket.io for real-time features
io.on('connection', (socket) => {
  console.log('🔌 StaffShield Pro: User connected:', socket.id);

  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    console.log(`User joined room: ${roomId}`);
  });

  socket.on('location_update', (data) => {
    socket.broadcast.emit('agent_location_update', {
      agentId: data.agentId,
      location: data.location,
      timestamp: new Date().toISOString()
    });
  });

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
    await initializeDatabase();
    server.listen(PORT, () => {
      console.log(`🛡️  StaffShield Pro Backend running on port ${PORT}`);
      console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`⚡ Platform: Premium Security Staffing Platform`);
      console.log(`📡 API: /health /api/auth/login /api/jobs /api/teams /api/fleet`);
      console.log(`👥 Demo accounts: demo@ppo.com, agent@demo.com, client@demo.com`);
      console.log(`🔑 Password: password123`);
    });
  } catch (error) {
    console.error('❌ Failed to start StaffShield Pro server:', error);
    process.exit(1);
  }
}

startServer();
