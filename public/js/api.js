// Shared fetch helper for talking to the AutomateKE backend.
const API_BASE = window.location.origin;

function getStoredToken(role) {
  return localStorage.getItem('ake_token_' + role) || '';
}
function setStoredToken(role, token) {
  if (token) localStorage.setItem('ake_token_' + role, token);
  else localStorage.removeItem('ake_token_' + role);
}

async function api(path, { method = 'GET', body, role } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = role ? getStoredToken(role) : null;
  if (token) headers.Authorization = 'Bearer ' + token;

  const res = await fetch(API_BASE + '/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const AKE = { api, getStoredToken, setStoredToken };
