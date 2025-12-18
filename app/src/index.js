const express = require('express');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const app = express();
const port = process.env.APP_PORT || 3000;

// Utility function to read secrets from files or environment variables
function readSecret(envVar, fileEnvVar, defaultValue = '') {
  // First try to read from file
  if (process.env[fileEnvVar]) {
    try {
      const content = fs.readFileSync(process.env[fileEnvVar], 'utf8').trim();
      if (content) return content;
    } catch (error) {
      console.warn(`Could not read secret file ${process.env[fileEnvVar]}:`, error.message);
    }
  }
  
  // Fall back to environment variable
  return process.env[envVar] || defaultValue;
}

// Read configuration from secrets
const dbPassword = readSecret('DB_PASSWORD', 'DB_PASSWORD_FILE');
const appSecret = readSecret('APP_SECRET', 'APP_SECRET_FILE');

// Validate configuration
if (!dbPassword) {
  console.error('Database password is not configured. Set DB_PASSWORD or DB_PASSWORD_FILE');
  process.exit(1);
}

if (!appSecret) {
  console.warn('Application secret is not configured. Using default for development only.');
}

// Database connection pool
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: dbPassword,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Simple middleware
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'api',
    environment: process.env.NODE_ENV || 'development',
  };

  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    health.database = 'connected';
    
    res.json(health);
  } catch (error) {
    health.status = 'unhealthy';
    health.database = 'disconnected';
    health.error = error.message;
    
    res.status(503).json(health);
  }
});

// Main endpoint
app.get('/', async (req, res) => {
  try {
    // Get database version
    const dbResult = await pool.query('SELECT version()');
    
    // Get user count from our schema
    const userResult = await pool.query(`
      SELECT COUNT(*) as user_count 
      FROM app_schema.users
    `);

    res.json({
      message: 'Docker Compose Node.js Application',
      database: {
        version: dbResult.rows[0].version.split(' ')[1],
        users: parseInt(userResult.rows[0].user_count),
      },
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      status: 'ok'
    });
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      error: 'Database query failed',
      message: error.message
    });
  }
});

// Create user endpoint
app.post('/users', async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO app_schema.users (username) VALUES ($1) RETURNING id, username, created_at',
      [username]
    );
    
    res.status(201).json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${port}/health`);
});