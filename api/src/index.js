require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
const { resumeOnStartup } = require('./pipelineExecutor');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
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

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`NEWCRMLUX API running on port ${PORT}`);
  // Resume any pipelines that were running before the last restart
  resumeOnStartup().catch(() => {});
});
