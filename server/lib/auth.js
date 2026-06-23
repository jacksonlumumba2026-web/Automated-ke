const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function sign(payload, expiresIn = '30d') {
  return jwt.sign(payload, SECRET, { expiresIn });
}

function verify(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function requireAuth(req, res, next) {
  const token = getToken(req);
  const payload = token && verify(token);
  if (!payload) return res.status(401).json({ error: 'Unauthorized' });
  req.auth = payload;
  next();
}

function requireAdmin(req, res, next) {
  const token = getToken(req);
  const payload = token && verify(token);
  if (!payload || payload.role !== 'admin') return res.status(401).json({ error: 'Unauthorized' });
  req.auth = payload;
  next();
}

function requireClient(req, res, next) {
  const token = getToken(req);
  const payload = token && verify(token);
  if (!payload || payload.role !== 'client') return res.status(401).json({ error: 'Unauthorized' });
  req.auth = payload;
  next();
}

module.exports = { sign, verify, requireAuth, requireAdmin, requireClient };
