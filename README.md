# StaffShield Pro Backend API

**Premium Security Staffing Platform Backend**

A comprehensive Node.js backend API for StaffShield Pro, a security staffing marketplace that connects Private Protection Officers (PPOs), Security Agents, and Clients for professional security services.

## 🚀 Live Deployment

**API Base URL:** https://staffshield-backend-production.up.railway.app

**Health Check:** https://staffshield-backend-production.up.railway.app/health

## 📋 Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Environment Setup](#environment-setup)
- [Database Schema](#database-schema)
- [API Documentation](#api-documentation)
- [Authentication](#authentication)
- [WebSocket Events](#websocket-events)
- [Deployment](#deployment)
- [Frontend Integration](#frontend-integration)
- [Development](#development)

## ✨ Features

### Core Business Logic
- **User Management**: PPOs, Security Agents, and Clients with role-based access
- **Job Posting & Matching**: AI-powered matching system for security assignments
- **Multi-Agent Team Building**: Coordinate teams for large security operations
- **Payment & Escrow System**: Stripe integration for secure transactions
- **Fleet Coordination**: Rental car integration for mobile security teams
- **Compliance Management**: Background checks, licensing, and certifications
- **Real-time Messaging**: WebSocket-powered communication system
- **Geolocation Services**: Location-based job matching and tracking

### Technical Features
- **JWT Authentication**: Secure token-based authentication
- **PostgreSQL Database**: Robust relational database with comprehensive schema
- **Stripe Integration**: Payment processing and webhook handling
- **WebSocket Support**: Real-time notifications and messaging
- **Security Middleware**: Helmet, CORS, rate limiting, and input validation
- **Health Monitoring**: Comprehensive health check endpoints
- **Error Handling**: Centralized error handling and logging

## 🛠 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL (Railway)
- **Authentication**: JWT (jsonwebtoken)
- **Payments**: Stripe API
- **Real-time**: Socket.IO
- **Security**: Helmet, CORS, express-rate-limit
- **Utilities**: bcryptjs, compression, morgan
- **Deployment**: Railway Platform

## 🔧 Environment Setup

### Required Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Environment Configuration
NODE_ENV=production
PORT=8080

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-key-here-32-characters-minimum

# Database Configuration
DATABASE_URL=postgresql://username:password@host:port/database

# Stripe Configuration
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_secret_here

# CORS Configuration
CORS_ORIGIN=https://your-frontend-domain.com
```

### Railway Environment Variables

The following environment variables are configured in Railway:

- `DATABASE_URL`: Automatically provided by Railway PostgreSQL service
- `JWT_SECRET`: 32+ character secure random string
- `STRIPE_SECRET_KEY`: Your Stripe secret key (currently using test key)
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook endpoint secret
- `NODE_ENV`: Set to "production"
- `CORS_ORIGIN`: Frontend domain for CORS configuration

## 🗄 Database Schema

The application automatically creates the following tables on startup:

### Core Tables
- **users**: User accounts (PPOs, Agents, Clients)
- **agent_profiles**: Security agent specific data
- **ppo_profiles**: Private Protection Officer company data
- **client_profiles**: Client company and billing information

### Business Logic Tables
- **jobs**: Security job postings and assignments
- **job_assignments**: Agent-to-job assignments and status
- **payments**: Payment transactions and Stripe integration
- **messages**: Real-time messaging system

### Fleet & Compliance Tables
- **fleet_vehicles**: Vehicle management for mobile security
- **vehicle_assignments**: Vehicle-to-job assignments
- **compliance_records**: Background checks, certifications, training

## 📚 API Documentation

### Base URL
```
https://staffshield-backend-production.up.railway.app/api
```

### Authentication Endpoints

#### POST /api/auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "firstName": "John",
  "lastName": "Doe",
  "userType": "client|agent|ppo",
  "phone": "+1234567890"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "userType": "client",
    "firstName": "John",
    "lastName": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### POST /api/auth/login
Authenticate user and receive JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "userType": "client",
    "firstName": "John",
    "lastName": "Doe"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### User Management Endpoints

#### GET /api/users/profile
Get current user profile (requires authentication).

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "userType": "client",
    "firstName": "John",
    "lastName": "Doe",
    "phone": "+1234567890",
    "isVerified": false,
    "isActive": true,
    "createdAt": "2025-07-08T19:00:00.000Z"
  }
}
```

#### PUT /api/users/profile
Update user profile information.

#### GET /api/users/agents
Get available security agents (for PPOs and Clients).

#### GET /api/users/ppos
Get available PPO companies (for Clients).

### Job Management Endpoints

#### GET /api/jobs
Get jobs based on user role and permissions.

**Query Parameters:**
- `status`: Filter by job status (open, assigned, in_progress, completed, cancelled)
- `location`: Filter by location
- `urgency`: Filter by urgency level (low, normal, high, urgent)
- `limit`: Number of results (default: 20)
- `offset`: Pagination offset (default: 0)

#### POST /api/jobs
Create a new security job posting (Clients only).

**Request Body:**
```json
{
  "title": "Corporate Event Security",
  "description": "Security coverage for corporate event with 200+ attendees",
  "locationAddress": "123 Business Center, City, State 12345",
  "startDate": "2025-07-15T18:00:00.000Z",
  "endDate": "2025-07-15T23:00:00.000Z",
  "hourlyRate": 35.00,
  "agentsNeeded": 3,
  "requiredCertifications": ["Security License", "CPR Certified"],
  "specialRequirements": "Professional attire required",
  "urgencyLevel": "normal",
  "equipmentProvided": true,
  "uniformRequired": true,
  "vehicleRequired": false
}
```

#### GET /api/jobs/:id
Get specific job details.

#### PUT /api/jobs/:id
Update job information (job creator only).

#### POST /api/jobs/:id/assign
Assign agents to a job (PPOs only).

#### POST /api/jobs/:id/apply
Apply for a job (Agents only).

### Payment Endpoints

#### POST /api/payments/create-payment-intent
Create Stripe payment intent for job payment.

#### POST /api/payments/webhook
Stripe webhook endpoint for payment status updates.

#### GET /api/payments/history
Get payment history for current user.

### Fleet Management Endpoints

#### GET /api/fleet/vehicles
Get available vehicles (PPOs only).

#### POST /api/fleet/vehicles
Add new vehicle to fleet.

#### POST /api/fleet/assign
Assign vehicle to job and agent.

### Compliance Endpoints

#### GET /api/compliance/records
Get compliance records for user.

#### POST /api/compliance/records
Submit new compliance record.

#### PUT /api/compliance/records/:id
Update compliance record status.

### Matching System Endpoints

#### POST /api/matching/find-agents
AI-powered agent matching for jobs.

#### GET /api/matching/recommendations
Get job recommendations for agents.

#### POST /api/matching/calculate-compatibility
Calculate compatibility score between agent and job.

### Messaging Endpoints

#### POST /api/messages
Send a new message.

#### GET /api/messages/conversation/:userId
Get conversation with specific user.

#### GET /api/messages/conversations
Get all conversations for current user.

#### PUT /api/messages/mark-read
Mark messages as read.

#### GET /api/messages/unread-count
Get unread message count.

## 🔐 Authentication

The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

### Token Payload
```json
{
  "userId": 1,
  "email": "user@example.com",
  "userType": "client",
  "iat": 1752003421,
  "exp": 1752608221
}
```

## 🔌 WebSocket Events

The application supports real-time communication via Socket.IO.

### Connection
```javascript
const socket = io('https://staffshield-backend-production.up.railway.app');
```

### Events

#### Client to Server
- `join_room`: Join a specific room (job, user, team)
- `send_message`: Send real-time message
- `job_update`: Update job status
- `location_update`: Update agent location

#### Server to Client
- `new_message`: Receive new message
- `receive_message`: Receive real-time message
- `job_status_update`: Job status changed
- `agent_location_update`: Agent location updated

### Example Usage
```javascript
// Join a job room
socket.emit('join_room', `job_${jobId}`);

// Send a message
socket.emit('send_message', {
  roomId: `job_${jobId}`,
  message: 'Agent en route to location',
  senderId: userId
});

// Listen for messages
socket.on('receive_message', (data) => {
  console.log('New message:', data);
});
```

## 🚀 Deployment

### Railway Deployment

The application is deployed on Railway with the following configuration:

1. **Service**: Node.js application
2. **Database**: PostgreSQL service
3. **Environment**: Production
4. **Port**: 8080 (automatically configured)
5. **Build Command**: `npm install`
6. **Start Command**: `npm start`

### Deployment URL
https://staffshield-backend-production.up.railway.app

### Database Connection
- **Host**: Provided by Railway PostgreSQL service
- **Database**: Automatically created and managed
- **Tables**: Auto-created on application startup
- **SSL**: Enabled for production security

## 🌐 Frontend Integration

### CORS Configuration
The API is configured to accept requests from your frontend domain. Update the `CORS_ORIGIN` environment variable with your frontend URL.

### API Client Setup
```javascript
const API_BASE_URL = 'https://staffshield-backend-production.up.railway.app/api';

// Example API client
class StaffShieldAPI {
  constructor(token) {
    this.token = token;
    this.baseURL = API_BASE_URL;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { Authorization: `Bearer ${this.token}` }),
        ...options.headers,
      },
      ...options,
    };

    const response = await fetch(url, config);
    return response.json();
  }

  // Authentication
  async login(email, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  async register(userData) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  // Jobs
  async getJobs(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/jobs?${query}`);
  }

  async createJob(jobData) {
    return this.request('/jobs', {
      method: 'POST',
      body: JSON.stringify(jobData),
    });
  }
}
```

### WebSocket Integration
```javascript
import io from 'socket.io-client';

const socket = io('https://staffshield-backend-production.up.railway.app');

// Authentication
socket.on('connect', () => {
  socket.emit('authenticate', { token: userToken });
});

// Join user-specific room
socket.emit('join_room', `user_${userId}`);

// Listen for real-time updates
socket.on('new_message', (message) => {
  // Handle new message
});

socket.on('job_status_update', (update) => {
  // Handle job status change
});
```

## 💻 Development

### Local Setup

1. **Clone the repository:**
```bash
git clone https://github.com/Rushington-dev/staffshield-pro-backend.git
cd staffshield-pro-backend
```

2. **Install dependencies:**
```bash
npm install
```

3. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start development server:**
```bash
npm run dev
```

The server will start on `http://localhost:3000` with auto-reload enabled.

### Available Scripts

- `npm start`: Start production server
- `npm run dev`: Start development server with nodemon
- `npm test`: Run test suite (to be implemented)
- `npm run lint`: Run ESLint (to be implemented)

### Database Management

The application automatically creates all required tables on startup. For manual database operations:

```javascript
const { createTables } = require('./config/database');

// Create tables manually
await createTables();
```

## 🔄 Next Steps for Frontend Integration

1. **Set up CORS**: Update `CORS_ORIGIN` environment variable with your frontend domain
2. **API Client**: Implement the API client shown above in your frontend
3. **Authentication Flow**: Implement login/register forms that call the auth endpoints
4. **WebSocket Connection**: Set up Socket.IO client for real-time features
5. **State Management**: Integrate API calls with your state management solution (Redux, Zustand, etc.)
6. **Error Handling**: Implement proper error handling for API responses
7. **Loading States**: Add loading indicators for API calls
8. **Token Management**: Implement secure token storage and refresh logic

### Recommended Frontend Structure
```
src/
├── api/
│   ├── client.js          # API client setup
│   ├── auth.js            # Authentication endpoints
│   ├── jobs.js            # Job management endpoints
│   ├── users.js           # User management endpoints
│   └── websocket.js       # WebSocket connection
├── components/
│   ├── auth/              # Login/register components
│   ├── jobs/              # Job listing/creation components
│   ├── messaging/         # Real-time messaging components
│   └── dashboard/         # User dashboard components
└── hooks/
    ├── useAuth.js         # Authentication hook
    ├── useJobs.js         # Jobs management hook
    └── useWebSocket.js    # WebSocket hook
```

## 📞 Support

For technical support or questions about the API, please contact the development team or create an issue in the GitHub repository.

---

**StaffShield Pro Backend API** - Built with ❤️ for premium security staffing solutions.
