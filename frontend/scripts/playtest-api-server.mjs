import http from 'node:http';

const port = Number(process.env.PORT || 8123);
const jobs = Array.from({ length: 25 }, (_, index) => ({
  id: `playtest-job-${index + 1}`,
  title: `Mission de démonstration ${index + 1}`,
  description: 'Mission locale vérifiable dans le parcours de démonstration.',
  category: index % 2 ? 'plumbing' : 'electrical',
  status: 'open',
  budget_min: 100 + index,
  budget_max: 250 + index,
  location: { address: 'Dakar, Sénégal' },
  client: { full_name: 'Client de démonstration' },
}));

const users = new Map([
  ['demo@example.com', { id: 'demo-user', email: 'demo@example.com', password: 'password', user_type: 'worker', first_name: 'Demo', last_name: 'Worker', is_verified: true, payment_accounts_count: 2 }],
  ['client@example.com', { id: 'demo-client', email: 'client@example.com', password: 'password', user_type: 'client', first_name: 'Demo', last_name: 'Client', is_verified: true, payment_accounts_count: 2 }],
]);
const sessions = new Map();
const proposals = [];
const payments = [];
let currentOrigin = '*';

const send = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': currentOrigin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Accept,Content-Type,Authorization,X-CSRFToken', ...headers });
  res.end(payload);
};
const readBody = (req) => new Promise((resolve, reject) => {
  let text = '';
  req.on('data', (chunk) => { text += chunk; });
  req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); } });
  req.on('error', reject);
});
const currentUser = (req) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return sessions.get(token) || null;
};
const route = (req) => new URL(req.url, `http://${req.headers.host}`);

const server = http.createServer(async (req, res) => {
  currentOrigin = req.headers.origin || '*';
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = route(req);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', fixture: true });
    if (req.method === 'GET' && path === '/geolocation/available-countries') return send(res, 200, { countries: [] });
    if (req.method === 'GET' && path === '/jobs') {
      const page = Math.max(1, Number(url.searchParams.get('page') || 1));
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 12)));
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const category = url.searchParams.get('category') || '';
      const filtered = jobs.filter((job) => (!query || job.title.toLowerCase().includes(query)) && (!category || job.category === category));
      const data = filtered.slice((page - 1) * limit, page * limit);
      return send(res, 200, { data, jobs: data, page, limit, has_more: page * limit < filtered.length, total: filtered.length });
    }
    if (req.method === 'GET' && /^\/jobs\/[^/]+$/.test(path)) {
      const job = jobs.find((item) => item.id === path.split('/').pop());
      return job ? send(res, 200, { ...job, location_text: job.location?.address || 'Dakar, Sénégal', client_name: job.client?.full_name || 'Client de démonstration', client_email: 'client@example.com' }) : send(res, 404, { detail: 'Mission introuvable' });
    }
    if (req.method === 'POST' && path === '/auth/login') {
      const body = await readBody(req); const user = users.get(body.email);
      if (!user || user.password !== body.password) return send(res, 401, { detail: 'Identifiants invalides' });
      const token = `fixture-${user.id}`; sessions.set(token, user);
      return send(res, 200, { user, token, access_token: token, token_expires_at: Date.now() + 3600000 });
    }
    if (req.method === 'POST' && path === '/auth/register-verified') {
      const body = await readBody(req); const user = { id: `user-${users.size + 1}`, email: body.email, password: body.password, user_type: body.user_type || 'client', first_name: body.first_name || 'Demo', last_name: body.last_name || 'User', is_verified: true, payment_accounts_count: 2 };
      users.set(user.email, user); const token = `fixture-${user.id}`; sessions.set(token, user);
      return send(res, 201, { user, token, access_token: token, token_expires_at: Date.now() + 3600000 });
    }
    if (req.method === 'GET' && path === '/auth/me') {
      const user = currentUser(req); return user ? send(res, 200, { user }) : send(res, 401, { detail: 'Session expirée' });
    }
    if (req.method === 'POST' && path === '/auth/logout') return send(res, 200, { success: true });
    if (req.method === 'GET' && path === '/proposals/mine') return send(res, 200, { data: proposals.filter((item) => item.worker_id === currentUser(req)?.id) });
    if (req.method === 'GET' && /^\/jobs\/[^/]+\/proposals$/.test(path)) return send(res, 200, { data: proposals.filter((item) => item.job_id === path.split('/')[2]) });
    if (req.method === 'POST' && /^\/jobs\/[^/]+\/proposals$/.test(path)) {
      const body = await readBody(req); const proposal = { id: `proposal-${proposals.length + 1}`, job_id: path.split('/')[2], worker_id: currentUser(req)?.id || 'demo-user', status: 'pending', ...body };
      proposals.push(proposal); return send(res, 201, { proposal });
    }
    if (req.method === 'POST' && path === '/jobs') {
      const body = await readBody(req); const job = { id: `created-${jobs.length + 1}`, status: 'open', ...body }; jobs.push(job); return send(res, 201, { job });
    }
    if (req.method === 'GET' && path === '/payments/config') return send(res, 200, { configured: true, provider: 'fixture' });
    if (req.method === 'POST' && path === '/payments/quote') { const body = await readBody(req); return send(res, 200, { amount: body.amount || 100, commission: 10, total: Number(body.amount || 100) + 10 }); }
    if (req.method === 'POST' && path === '/payments/checkout') {
      const body = await readBody(req); const payment = { id: `payment-${payments.length + 1}`, status: 'pending', ...body }; payments.push(payment); return send(res, 201, { payment, checkout_url: `http://127.0.0.1:${port}/fixture-checkout/${payment.id}` });
    }
    if (req.method === 'GET' && path === '/payments/status') return send(res, 200, { status: 'pending' });
    if (req.method === 'GET' && path === '/public/stats') return send(res, 200, { jobs: jobs.length, workers: 1, completed_jobs: 0 });
    return send(res, 404, { detail: 'Fixture route not implemented' });
  } catch (error) {
    return send(res, 400, { detail: error.message });
  }
});

server.listen(port, '127.0.0.1', () => console.log(`KOJO playtest API listening on http://127.0.0.1:${port}`));
