require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const transactionRoutes = require('./routes/transactions');
const contactRoutes = require('./routes/contacts');
const followupRoutes = require('./routes/followups');
const settingsRoutes = require('./routes/settings');
const followupCron = require('./cron/followups');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/settings', settingsRoutes);

// Static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

followupCron.start();

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`AutomateKE server running on port ${PORT}`));
