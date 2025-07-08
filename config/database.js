const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('ppo', 'agent', 'client')),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        profile_image_url TEXT,
        is_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        license_number VARCHAR(100),
        license_state VARCHAR(2),
        license_expiry DATE,
        certifications TEXT[],
        experience_years INTEGER DEFAULT 0,
        availability_status VARCHAR(20) DEFAULT 'available',
        location_lat DECIMAL(10,8),
        location_lng DECIMAL(11,8),
        background_check_status VARCHAR(20) DEFAULT 'pending',
        background_check_date DATE,
        rating DECIMAL(3,2) DEFAULT 0.00,
        total_jobs INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ppo_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_name VARCHAR(255) NOT NULL,
        license_number VARCHAR(100) NOT NULL,
        license_state VARCHAR(2) NOT NULL,
        license_expiry DATE NOT NULL,
        insurance_policy_number VARCHAR(100),
        bonding_amount DECIMAL(12,2),
        rating DECIMAL(3,2) DEFAULT 0.00,
        total_jobs INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS client_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        company_name VARCHAR(255),
        industry VARCHAR(100),
        company_size VARCHAR(20),
        billing_address TEXT,
        payment_method_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        client_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ppo_id INTEGER REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        location_address TEXT NOT NULL,
        location_lat DECIMAL(10,8),
        location_lng DECIMAL(11,8),
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP NOT NULL,
        agents_needed INTEGER NOT NULL DEFAULT 1,
        required_certifications TEXT[],
        special_requirements TEXT,
        status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'in_progress', 'completed', 'cancelled')),
        urgency_level VARCHAR(10) DEFAULT 'normal' CHECK (urgency_level IN ('low', 'normal', 'high', 'urgent')),
        equipment_provided BOOLEAN DEFAULT FALSE,
        uniform_required BOOLEAN DEFAULT FALSE,
        vehicle_required BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS job_assignments (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        agent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        hourly_rate DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'assigned' CHECK (status IN ('assigned', 'accepted', 'declined', 'completed', 'no_show')),
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP,
        completed_at TIMESTAMP,
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        feedback TEXT,
        UNIQUE(job_id, agent_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        payer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        payee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        stripe_payment_intent_id VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'refunded')),
        payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('job_payment', 'platform_fee', 'refund')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS fleet_vehicles (
        id SERIAL PRIMARY KEY,
        ppo_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        make VARCHAR(50) NOT NULL,
        model VARCHAR(50) NOT NULL,
        year INTEGER NOT NULL,
        license_plate VARCHAR(20) NOT NULL,
        vin VARCHAR(17),
        color VARCHAR(30),
        vehicle_type VARCHAR(30) NOT NULL,
        status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'maintenance', 'retired')),
        daily_rate DECIMAL(8,2),
        insurance_policy VARCHAR(100),
        registration_expiry DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS vehicle_assignments (
        id SERIAL PRIMARY KEY,
        vehicle_id INTEGER REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        agent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        returned_at TIMESTAMP,
        mileage_start INTEGER,
        mileage_end INTEGER,
        fuel_level_start DECIMAL(3,2),
        fuel_level_end DECIMAL(3,2),
        condition_notes TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recipient_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
        message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'location')),
        content TEXT NOT NULL,
        attachment_url TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS compliance_records (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        record_type VARCHAR(30) NOT NULL CHECK (record_type IN ('background_check', 'drug_test', 'training', 'certification')),
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
        issued_date DATE,
        expiry_date DATE,
        issuing_authority VARCHAR(255),
        document_url TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await client.query('COMMIT');
    console.log('Database tables created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { pool, createTables };
