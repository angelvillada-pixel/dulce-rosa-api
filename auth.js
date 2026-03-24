const { createRemoteJWKSet, jwtVerify } = require('jose');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'dulce-rosa';
const DEFAULT_ADMIN_EMAILS = ['dulcerosa794@gmail.com', 'ducerosa794@gmail.com'];
const configuredEmails = String(process.env.FIREBASE_ADMIN_EMAILS || process.env.FIREBASE_ADMIN_EMAIL || '')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAILS = new Set(configuredEmails.length ? configuredEmails : DEFAULT_ADMIN_EMAILS);
const FIREBASE_ADMIN_EMAIL = [...ADMIN_EMAILS][0] || 'dulcerosa794@gmail.com';
const ADMIN_AUTH_BYPASS = process.env.ADMIN_AUTH_BYPASS === 'true';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

function readBearerToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return '';
  return header.slice('Bearer '.length).trim();
}

async function verifyFirebaseToken(token) {
  if (!token) {
    const error = new Error('Falta el token de autenticacion admin.');
    error.status = 401;
    throw error;
  }

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
  });

  if (!payload?.email || !ADMIN_EMAILS.has(String(payload.email).trim().toLowerCase())) {
    const error = new Error('La cuenta autenticada no tiene permisos de admin.');
    error.status = 403;
    throw error;
  }

  return payload;
}

async function requireAdminAuth(req, _res, next) {
  try {
    if (ADMIN_AUTH_BYPASS) {
      req.adminUser = { email: FIREBASE_ADMIN_EMAIL, bypass: true };
      next();
      return;
    }

    const token = readBearerToken(req);
    req.adminUser = await verifyFirebaseToken(token);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  ADMIN_EMAILS,
  FIREBASE_ADMIN_EMAIL,
  FIREBASE_PROJECT_ID,
  requireAdminAuth,
};
