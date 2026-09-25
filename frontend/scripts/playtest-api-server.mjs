import http from 'node:http';

const rawPort = process.env.PORT;
const port = rawPort && rawPort !== '0' ? Number(rawPort) : 8123;
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
// Centre de notifications de la fixture : une ligne NON LUE par compte, servie
// à la connexion. C'est ce que le parcours e2e « notifications » supprime — une
// vraie fixture serveur, donc une vraie requête HTTP, pas une doublure.
const notifications = new Map();
const notifierLeCompte = (user) => {
  if (notifications.has(user.id)) return;
  notifications.set(user.id, [{
    id: 'notif-fixture-1',
    user_id: user.id,
    title: 'Nouvelle proposition reçue',
    body: 'Famakan Kontaga a soumis une proposition pour « Test postulation »',
    type: 'proposal_received',
    related_id: 'playtest-job-1',
    related_type: 'job',
    is_read: false,
    created_at: new Date().toISOString(),
  }]);
};
let currentOrigin = 'http://127.0.0.1:4173';

const send = (res, status, body, headers = {}) => {
  const payload = JSON.stringify(body);
  const allowOrigin = currentOrigin && currentOrigin !== '*' ? currentOrigin : 'http://127.0.0.1:4173';
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Accept,Content-Type,Authorization,X-CSRFToken',
    ...headers
  });
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
  if (req.headers.origin) {
    currentOrigin = req.headers.origin;
  }
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = route(req);
  const path = url.pathname.replace(/^\/api/, '') || '/';
  try {
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', fixture: true });
    if (req.method === 'GET' && path === '/geolocation/available-countries') return send(res, 200, { countries: [] });
    if (req.method === 'GET' && path === '/geolocation/detect') return send(res, 200, { detected: false, country: null });
    if (req.method === 'GET' && path === '/notifications') {
      const lignes = notifications.get(currentUser(req)?.id) || [];
      return send(res, 200, {
        notifications: lignes,
        unread_count: lignes.filter((item) => !item.is_read).length,
        total: lignes.length,
      });
    }
    if (req.method === 'GET' && path === '/notifications/unread-count') {
      const lignes = notifications.get(currentUser(req)?.id) || [];
      return send(res, 200, { unread_count: lignes.filter((item) => !item.is_read).length });
    }
    if (req.method === 'PUT' && path === '/notifications/mark-all-read') {
      const lignes = notifications.get(currentUser(req)?.id) || [];
      lignes.forEach((item) => { item.is_read = true; });
      return send(res, 200, { message: 'Toutes les notifications marquées comme lues', updated: lignes.length });
    }
    if (req.method === 'PUT' && /^\/notifications\/[^/]+\/read$/.test(path)) {
      const lignes = notifications.get(currentUser(req)?.id) || [];
      const ligne = lignes.find((item) => item.id === path.split('/')[2]);
      if (!ligne) return send(res, 404, { detail: 'Notification introuvable' });
      ligne.is_read = true;
      return send(res, 200, { message: 'Notification marquée comme lue' });
    }
    if (req.method === 'DELETE' && path === '/notifications') {
      const lignes = notifications.get(currentUser(req)?.id) || [];
      notifications.set(currentUser(req)?.id, []);
      return send(res, 200, { message: `${lignes.length} notification(s) supprimée(s)`, deleted: lignes.length });
    }
    if (req.method === 'DELETE' && /^\/notifications\/[^/]+$/.test(path)) {
      const lignes = notifications.get(currentUser(req)?.id) || [];
      const index = lignes.findIndex((item) => item.id === path.split('/').pop());
      if (index === -1) return send(res, 404, { detail: 'Notification introuvable' });
      lignes.splice(index, 1);
      return send(res, 200, { message: 'Notification supprimée' });
    }
    if (req.method === 'GET' && path === '/notifications/vapid-public-key') return send(res, 200, { vapid_public_key: '' });
    if (req.method === 'GET' && path === '/workers/profile') return send(res, 200, { profile: null });
    if (req.method === 'GET' && /^\/users\/[^/]+\/reviews$/.test(path)) return send(res, 200, { reviews: [] });
    if (req.method === 'GET' && path === '/users/referral') return send(res, 200, { referral_code: null, reward_balance: 0 });
    if (req.method === 'GET' && path === '/users/referral/filleuls') return send(res, 200, { filleuls: [] });
    if (req.method === 'GET' && path === '/users/portfolio') return send(res, 200, { portfolio_images: [] });
    if (req.method === 'GET' && path === '/users/profile-photo') return send(res, 200, { photo_url: null });
    if (req.method === 'GET' && path === '/users/payment-accounts') return send(res, 200, { payment_accounts: [] });
    if (req.method === 'GET' && path === '/geolocation/cities') return send(res, 200, { cities: [] });
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
      const token = `fixture-${user.id}`; sessions.set(token, user); notifierLeCompte(user);
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
