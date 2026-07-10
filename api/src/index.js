require('dotenv').config();

// Fail-fast: variáveis obrigatórias têm de estar definidas antes de qualquer import
const REQUIRED_ENV = ['JWT_SECRET', 'INTERNAL_API_KEY', 'ENCRYPTION_KEY']
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: variável de ambiente "${key}" não definida. O servidor não pode arrancar.`)
    process.exit(1)
  }
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const propertiesRoutes = require('./routes/properties');
const storageRoutes = require('./routes/storage');
const syncRoutes = require('./routes/sync');
const connectionsRoutes = require('./routes/connections');
const workersRoutes = require('./routes/workers');
const endpointsRoutes = require('./routes/endpoints');
const credentialsRoutes = require('./routes/credentials');
const pipelinesRoutes = require('./routes/pipelines');
const serverMonitorRoutes = require('./routes/server-monitor');
const databaseRoutes      = require('./routes/database');
const c21pushRoutes       = require('./routes/c21push');
const whatsappRoutes      = require('./routes/whatsapp');
const scrapeRoutes        = require('./routes/scrape');
const notificationsRoutes = require('./routes/notifications');
const { resumeOnStartup } = require('./pipelineExecutor');
const pool = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      frameSrc:   ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}))

// ── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',').map(o => o.trim()).filter(Boolean)

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true) // server-to-server / curl
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

// ── Rate limiting ───────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { error: 'Demasiadas tentativas. Aguarda 1 minuto.' },
})

app.use('/api/auth/login', authLimiter)
app.use('/api/auth/change-password', authLimiter)

// ── Body parsers ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/connections', connectionsRoutes);
app.use('/api/workers', workersRoutes);
app.use('/api/endpoints', endpointsRoutes);
app.use('/api/credentials', credentialsRoutes);
app.use('/api/pipelines', pipelinesRoutes);
app.use('/api/server-monitor', serverMonitorRoutes);
app.use('/api/database',      databaseRoutes);
app.use('/api/21online',      c21pushRoutes);
app.use('/api/whatsapp',      whatsappRoutes);
app.use('/api/scrape',        scrapeRoutes);
app.use('/api/notifications', notificationsRoutes);

app.use(errorHandler);

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS c21_user_contacts (
        id SERIAL PRIMARY KEY,
        external_id TEXT UNIQUE NOT NULL,
        workspace_id TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_c21_user_contacts_workspace ON c21_user_contacts(workspace_id)`);
    console.log('[migrations] c21_user_contacts OK');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS c21_leads (
        id SERIAL PRIMARY KEY,
        external_id TEXT UNIQUE NOT NULL,
        workspace_id TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_c21_leads_workspace ON c21_leads(workspace_id)`);
    console.log('[migrations] c21_leads OK');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS c21_calendar (
        id SERIAL PRIMARY KEY,
        external_id TEXT UNIQUE NOT NULL,
        workspace_id TEXT,
        data JSONB NOT NULL DEFAULT '{}',
        imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_c21_calendar_workspace ON c21_calendar(workspace_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_c21_calendar_type ON c21_calendar USING gin((data->'type') jsonb_path_ops) `);
    console.log('[migrations] c21_calendar OK');
    await pool.query(`ALTER TABLE c21_pipeline_endpoints ADD COLUMN IF NOT EXISTS runs_per_day INT DEFAULT NULL`);
    await pool.query(`ALTER TABLE c21_pipeline_endpoints ADD COLUMN IF NOT EXISTS incremental_months INT DEFAULT 14`);
    await pool.query(`ALTER TABLE c21_pipeline_endpoints DROP CONSTRAINT IF EXISTS c21_pipeline_endpoints_backfill_mode_check`);
    await pool.query(`ALTER TABLE c21_pipeline_endpoints ADD CONSTRAINT c21_pipeline_endpoints_backfill_mode_check CHECK (backfill_mode IN ('full','from_date','incremental'))`);
    console.log('[migrations] c21_pipeline_endpoints columns OK');

    // Security migrations
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0`);
    console.log('[migrations] users.token_version OK');

    // Notification config + log tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_config (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        phone_number TEXT NOT NULL DEFAULT '',
        enabled BOOLEAN NOT NULL DEFAULT false,
        cpu_threshold INT DEFAULT NULL,
        ram_threshold INT DEFAULT NULL,
        disk_threshold INT DEFAULT NULL,
        cpu_message TEXT NOT NULL DEFAULT 'Alerta CRM: CPU {value}% (limite: {threshold}%)',
        ram_message TEXT NOT NULL DEFAULT 'Alerta CRM: RAM {value}% (limite: {threshold}%)',
        disk_message TEXT NOT NULL DEFAULT 'Alerta CRM: Disco {value}% (limite: {threshold}%)',
        job_fail_message TEXT NOT NULL DEFAULT 'CRM Job falhou - {endpoint} ({workspace}): {error}',
        job_cancel_message TEXT NOT NULL DEFAULT 'CRM Job cancelado - {endpoint} ({workspace})',
        monitored_endpoints JSONB NOT NULL DEFAULT '[]',
        cooldown_minutes INT NOT NULL DEFAULT 15,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        details TEXT,
        phone_number TEXT,
        success BOOLEAN NOT NULL DEFAULT false,
        error_msg TEXT,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notif_log_type_sent ON notification_log(type, sent_at DESC)`);
    console.log('[migrations] notification_config + notification_log OK');

    // WhatsApp / Evolution Go tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_instances (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        connected BOOLEAN NOT NULL DEFAULT false,
        jid TEXT,
        disconnect_reason TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS token TEXT`);
    await pool.query(`ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS qrcode TEXT`);
    console.log('[migrations] whatsapp_instances OK');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id SERIAL PRIMARY KEY,
        instance_name TEXT NOT NULL,
        message_id TEXT UNIQUE NOT NULL,
        remote_jid TEXT,
        from_me BOOLEAN NOT NULL DEFAULT false,
        message_type TEXT,
        content JSONB,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wamsg_instance ON whatsapp_messages(instance_name)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wamsg_jid ON whatsapp_messages(remote_jid)`);
    console.log('[migrations] whatsapp_messages OK');
  } catch (err) {
    console.error('[migrations] Error:', err.message);
  }
}

app.listen(PORT, () => {
  console.log(`NEWCRMLUX API running on port ${PORT}`);
  runMigrations().catch(() => {});
  resumeOnStartup().catch(() => {});
});
