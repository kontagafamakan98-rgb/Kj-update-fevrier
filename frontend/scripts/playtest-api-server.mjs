import http from 'node:http';

const rawPort = process.env.PORT;
const port = rawPort && rawPort !== '0' ? Number(rawPort) : 8123;
// Les missions de démonstration sont construites par une FONCTION (et non par
// un littéral unique) : la connexion doit pouvoir reposer le MÊME jeu, sinon un
// parcours d'une passe précédente laisserait ses créations dans la liste — la
// même classe de rouge d'état que la semence de notifications, par accumulation
// au lieu de disparition.
const jobs = [];

// `country` est REQUIS par le modèle réel (`backend/kojo_models.py`, `country:
// Country`) et la fixture ne l'omettait pas par choix : elle l'ignorait, donc
// `/profile` n'avait aucun pays à montrer — ni, par conséquent, aucune carte de
// localisation à différer (`e2e/helpers/parcours-carte.js` lit ce même pays).
const users = new Map([
  ['demo@example.com', { id: 'demo-user', email: 'demo@example.com', password: 'password', user_type: 'worker', country: 'senegal', first_name: 'Demo', last_name: 'Worker', is_verified: true, payment_accounts_count: 2 }],
  ['client@example.com', { id: 'demo-client', email: 'client@example.com', password: 'password', user_type: 'client', country: 'senegal', first_name: 'Demo', last_name: 'Client', is_verified: true, payment_accounts_count: 2 }],
]);
const sessions = new Map();
const proposals = [];
const payments = [];
const notifications = new Map();

/**
 * ── L'ÉTAT SEMÉ EST REPOSÉ À CHAQUE CONNEXION, ET C'EST LA RÈGLE ────────────
 *
 * Une CONNEXION vaut un départ d'état FRAIS pour le compte : sa semence est
 * reposée (et non « posée si absente »), et les listes que les parcours
 * ALIMENTENT (propositions, missions créées, paiements) repartent vides ou à
 * leur jeu de démonstration. Deux raisons, mesurées toutes les deux.
 *
 * 1. UNE DONNÉE SEMÉE NE DOIT PLUS DISPARAÎTRE DÉFINITIVEMENT. La semence était
 *    gardée UNE FOIS par compte (`if (notifications.has(user.id)) return`), donc
 *    une ligne supprimée — ou marquée lue — ne revenait JAMAIS. Mesuré le
 *    07/10/2026 : `npx playwright test e2e/notifications.spec.js --repeat-each=2`
 *    passait au premier tour puis rendait DEUX rouges au second (« Expected
 *    substring: "1", Received string: "" ») sur un code applicatif intact — un
 *    rouge d'ÉTAT qui accuse le code. Le même rouge devient PERMANENT dès que le
 *    serveur survit à la passe : `reuseExistingServer` est vrai hors CI, et
 *    `npm run playtest:api` le laisse tourner entre deux exécutions.
 *
 * 2. AUCUN PARCOURS NE DÉPEND DE LA SURVIE DE SON ÉTAT AU-DELÀ DE SA SESSION.
 *    Celui qui supprime la ligne le fait DANS la session qui l'a ouverte, sans
 *    se reconnecter ; aucun autre ne relit ce qu'il a créé après une nouvelle
 *    connexion. Reposer l'état à la connexion ne retire donc rien à ce qui est
 *    mesuré, et retire ce que le hasard de l'ordre des cas y ajoutait.
 *
 * La graine de notifications reste une ligne NON LUE servie à la connexion :
 * c'est ce que le parcours « notifications » supprime par une VRAIE requête
 * HTTP — une vraie fixture serveur, pas une doublure.
 */
// `created_at` est REQUIS pour que les deux routes qui l'affichent rendent leur
// état réel : le détail d'une mission préfère `posted_at || created_at ||
// updated_at` (`pages/JobDetails.js`) et la carte de `/jobs` lit `posted_at ||
// created_at` (`components/JobsResults.js`). Sans lui, la fiche affichait
// « Publié le Date non renseignée » — mesuré le 08/10/2026 par la sonde des
// routes connectées, qui étend son périmètre à `/jobs/:id`. La date est FIXE et
// déterministe (l'index décide du jour) : une fixture qui bouge à chaque
// exécution ferait varier ce que les sondes comparent d'un run à l'autre.
const DATE_DE_REFERENCE = Date.UTC(2026, 8, 1, 9, 0, 0);

/**
 * ── LA PREMIÈRE MISSION PORTE UNE ANNONCE LONGUE, ET C'EST UNE MESURE ───────
 *
 * `/jobs/:id` n'a AUCUNE longueur maximale : sa hauteur suit celle de la
 * description de la mission, et sa déclaration le dit (`src/config/app-cadres.js`,
 * règle `pied-hors-ecran` : « la page grandit avec la DESCRIPTION de la
 * mission »). Une fixture qui répond une phrase ne mesurait donc pas la page que
 * la production sert : elle mesurait le cas COURT, celui où la réserve d'un
 * écran dépasse la page et où le pied de page — réservé SOUS la ligne de
 * flottaison — remonte DANS l'écran à l'arrivée des données. C'est ce décalage
 * (0,0166 en desktop, 0,0000 en mobile) qui a fixé le plafond de `/jobs/:id`
 * dans `scripts/lhci-cls-budgets.cjs`.
 *
 * La première mission porte donc une annonce de PLUSIEURS PARAGRAPHES, comme
 * celle qu'un client publie réellement : le relevé de la sonde des routes
 * connectées (`e2e/cadres-app.spec.js`, qui visite `playtest-job-1`) mesure
 * désormais le cas LONG — celui de la production — au lieu du cas court.
 *
 * Les VINGT-QUATRE AUTRES RESTENT COURTES, et c'est délibéré : elles peuplent la
 * LISTE de `/jobs`, où une carte n'affiche que deux lignes (`line-clamp-2`,
 * `components/JobsResults.js`) — leur description ne pèse donc ni sur la hauteur
 * de la liste ni sur ce qui s'y lit, et leur variété fait vivre le filtrage et
 * la pagination des parcours.
 *
 * Le texte est FIXE (aucun tirage aléatoire, aucune date relative) : deux runs
 * doivent peindre la même page, sans quoi la hauteur relevée — et le CLS qui en
 * découle — varieraient d'une exécution à l'autre sans qu'aucun code ait bougé.
 */
const ANNONCE_LONGUE = [
  "Nous recherchons un électricien qualifié pour la pose complète de l'installation électrique d'une villa en fin de construction à Diamniadio, à une trentaine de kilomètres de Dakar. La maison compte cinq pièces, deux salles d'eau, une cuisine et un garage, sur deux niveaux. Le gros œuvre est terminé, les murs sont crépis et les gaines principales ont été posées par le maçon : il reste à faire tout le second œuvre électrique avant la pose des faux plafonds, prévue dans trois semaines.",

  'Les travaux à réaliser, dans cet ordre :',

  '- tirer les câbles dans les gaines existantes et percer les passages manquants (béton et brique) ;',
  '- poser et raccorder le tableau divisionnaire : un disjoncteur général, un différentiel 30 mA, ainsi que les circuits éclairage, prises, climatisation et chauffe-eau ;',
  '- installer les points lumineux intérieurs et extérieurs (une vingtaine au total), les interrupteurs et les prises ;',
  '- mettre à la terre la maison entière et poser le piquet de terre ;',
  '- repérer proprement chaque circuit dans le tableau, avec un schéma laissé au propriétaire.',

  'Le matériel est déjà acheté : câbles, gaines, boîtes d\'encastrement, disjoncteurs, prises et interrupteurs sont stockés sur place. Il reste à prévoir les petites fournitures (colliers, dominos, goulottes) : elles seront remboursées sur présentation des tickets, en plus du montant convenu.',

  "Le profil recherché : une personne ayant déjà réalisé au moins trois installations complètes, capable de lire un plan de distribution et de travailler seule, sans être suivie au quotidien. La ponctualité compte : la famille doit emménager à la fin du mois et le chantier ne peut pas s'arrêter en cours de route. Le permis de conduire n'est pas exigé, mais la villa est mal desservie par les transports en commun — prévoir un moyen de déplacement personnel jusqu'à Diamniadio.",

  'Le chantier est prévu sur six jours ouvrés, du lundi au samedi, de 8 h à 17 h avec une pause déjeuner. Le paiement se fait en deux fois : 40 % à la moitié du chantier, le solde à la réception, une fois les essais faits devant le propriétaire. Une avance sur le matériel est possible si nécessaire, à discuter par message avant le début des travaux.',

  'Pour candidater, précisez en quelques lignes vos installations précédentes, le matériel dont vous disposez (perceuse à percussion, testeur, pince à dénuder) et la date à laquelle vous pouvez commencer. Les candidatures reçues par la plateforme sont transmises directement au propriétaire ; celui-ci répond sous 48 heures.',
].join('\n\n');

const missionsDeDemonstration = () =>
  Array.from({ length: 25 }, (_, index) => ({
    id: `playtest-job-${index + 1}`,
    title: `Mission de démonstration ${index + 1}`,
    // La PREMIÈRE est l'annonce longue (voir ci-dessus) ; les autres gardent la
    // phrase courte de la liste.
    description:
      index === 0 ? ANNONCE_LONGUE : 'Mission locale vérifiable dans le parcours de démonstration.',
    category: index % 2 ? 'plumbing' : 'electrical',
    status: 'open',
    budget_min: 100 + index,
    budget_max: 250 + index,
    created_at: new Date(DATE_DE_REFERENCE + index * 3600000).toISOString(),
    location: { address: 'Dakar, Sénégal' },
    client: { full_name: 'Client de démonstration' },
  }));

/**
 * ── LA LISTE PUBLIQUE EXISTE DÈS LE DÉMARRAGE, ET C'EST UNE MESURE ─────────
 *
 * `/jobs` se visite SANS session : `e2e/user-flows.spec.js` ouvre la liste
 * AVANT toute connexion et exige d'y voir les missions de démonstration. Semer
 * cet état seulement à la connexion faisait donc dépendre la réponse PUBLIQUE
 * de l'ordre des cas : lancée seule, la spec rendait DEUX rouges (« Received: 0 »
 * sur `text=Mission de démonstration`) que la suite complète masquait parce
 * qu'une autre spec — `cadres-app`, `carte-facade`, `notifications` — avait
 * ouvert une session plus tôt dans le MÊME processus. La liste est donc posée
 * au chargement du module AUSSI : le premier visiteur anonyme voit le jeu
 * complet, exactement comme après une connexion.
 *
 * CE DÉFAUT ÉTAIT MASQUÉ PAR LA SUITE COMPLÈTE (257 verts avant correction) et
 * n'a été trouvé qu'en lançant le fichier SEUL : « la suite est verte » ne dit
 * rien de la dépendance à l'ORDRE entre fichiers, et le seul juge de cette
 * dépendance est chaque fichier lancé seul (17/17 verts après correction).
 */
jobs.push(...missionsDeDemonstration());

const graineDeNotifications = (user) => ([
  {
    id: 'notif-fixture-1',
    user_id: user.id,
    title: 'Nouvelle proposition reçue',
    body: 'Famakan Kontaga a soumis une proposition pour « Test postulation »',
    type: 'proposal_received',
    related_id: 'playtest-job-1',
    related_type: 'job',
    is_read: false,
    created_at: new Date().toISOString(),
  },
]);

/** Le départ d'état FRAIS du compte, posé à chaque connexion réussie. */
const reposerLEtatDuCompte = (user) => {
  notifications.set(user.id, graineDeNotifications(user));
  proposals.length = 0;
  payments.length = 0;
  jobs.length = 0;
  jobs.push(...missionsDeDemonstration());
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
    // Une liste de conversations VIDE, et c'est une réponse RÉUSSIE : la sonde
    // des routes connectées (`e2e/cadres-app.spec.js`) mesure le cadre et le CLS
    // de /messages, et un 404 lui aurait fait mesurer un état d'ERREUR — un autre
    // écran que celui qu'un visiteur voit. Même posture que `/jobs` avec une
    // liste vide : la donnée est pauvre, le chemin est celui de la production.
    if (req.method === 'GET' && path === '/messages/conversations') return send(res, 200, []);
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
      const token = `fixture-${user.id}`; sessions.set(token, user); reposerLEtatDuCompte(user);
      return send(res, 200, { user, token, access_token: token, token_expires_at: Date.now() + 3600000 });
    }
    if (req.method === 'POST' && path === '/auth/register-verified') {
      const body = await readBody(req); const user = { id: `user-${users.size + 1}`, email: body.email, password: body.password, user_type: body.user_type || 'client', first_name: body.first_name || 'Demo', last_name: body.last_name || 'User', is_verified: true, payment_accounts_count: 2 };
      users.set(user.email, user); const token = `fixture-${user.id}`; sessions.set(token, user);
      return send(res, 201, { user, token, access_token: token, token_expires_at: Date.now() + 3600000 });
    }
    // Le VRAI backend renvoie l'utilisateur NU (`return current_user.model_dump(...)`,
    // kojo_routers_auth.py), et le frontend le pose tel quel (`setUser(userData)`
    // dans AuthContext.loadUser). La fixture l'enveloppait dans `{ user }` :
    // `ProtectedRoute` lisait alors `is_verified: undefined` sur l'enveloppe et
    // renvoyait TOUTE page protégée vers /payment-verification — /profile,
    // /dashboard, /messages compris. Aucun parcours ne l'avait vu parce
    // qu'aucun n'avait besoin d'y arriver.
    if (req.method === 'GET' && path === '/auth/me') {
      const user = currentUser(req); return user ? send(res, 200, user) : send(res, 401, { detail: 'Session expirée' });
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
