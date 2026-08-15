# Kojo — Plateforme de mise en relation artisans / clients

Kojo connecte clients et artisans en Afrique de l'Ouest (Sénégal, Mali, Côte d'Ivoire, Burkina Faso). Paiement sécurisé via PayDunya (Orange Money, Wave, carte bancaire).

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, Vite 7, Tailwind CSS, React Router 7, Capacitor |
| Backend | Python 3.11, FastAPI, Motor (MongoDB async) |
| Base de données | MongoDB Atlas |
| Paiements | PayDunya (Orange Money, Wave, carte) |
| Photos | Cloudinary |
| Emails | Brevo / Gmail OAuth2 (ou `EMAIL_PROVIDER=none`) |
| Notifications push | VAPID (pywebpush) |
| Déploiement | Render (backend) + Vercel (frontend) |

## Setup local

### Backend
```bash
cd backend
cp .env.example .env        # Remplir les valeurs
python -m venv .venv        # Optionnel mais recommandé
.venv/Scripts/pip install -r requirements.txt   # Windows ; .venv/bin/pip sur Unix
uvicorn server:app --reload --port 8000
```

Le backend est découpé par domaine (le monolithe `server.py` de 5 000+ lignes a
été éclaté) :

```
backend/
├── server.py              # Point d'entrée : app, middlewares, routers, lifespan
├── kojo_settings.py       # Config (env, logging, secrets, en-têtes sécurité)
├── kojo_models.py         # Modèles Pydantic + énumérations
├── kojo_core.py           # MongoDB, index, rate-limiting, sécurité, auth
├── kojo_email.py          # OTP / vérification email / Brevo / Gmail
├── kojo_shared.py         # Notifications (base + push web), adresses mission
├── kojo_payments.py       # Intégration PayDunya (factures, statuts, décaissements)
├── kojo_routers_*.py      # Endpoints HTTP par domaine (auth, users, jobs,
│                          #   messages, payments, notifications, geo, owner, support)
└── tests/                 # 60 tests pytest
```

### Frontend
```bash
cd frontend
cp .env.example .env.local  # Adapter VITE_API_URL si besoin
npm install
npm run dev
```

Prérequis frontend : Node >= 20.19 (CI : Node 24).

### Tests
```bash
# Backend — deux modes :
cd backend
.venv/Scripts/python -m pytest tests/ -v              # FakeDB locale (hermétique)
TEST_MONGO_URL=mongodb://localhost:27017 .venv/Scripts/python -m pytest tests/ -v   # vrai MongoDB

# Frontend
cd frontend && npm test
```

> Les tests backend passent par défaut sur une **fausse base en mémoire**
> (rapide, sans dépendance). En définissant `TEST_MONGO_URL`, la **même suite**
> s'exécute contre un vrai MongoDB (mode utilisé en CI via un service
> container) pour couvrir atomicité/indexes/opérateurs réels.

## Déploiement

**Backend (Render)** — Web Service Python
Start command : `uvicorn server:app --host 0.0.0.0 --port $PORT`
Variables d'env → voir `backend/.env.example` (`JWT_SECRET` et
`EMAIL_OTP_SECRET` sont **obligatoires** en production — le serveur refuse de
démarrer sans eux).

**Frontend (Vercel)** — `vercel.json` à la racine (output `frontend/build`)
Variables d'env → voir `frontend/.env.example`

## Sécurité

- **Inscription** : seule la route `/api/auth/register-verified` existe ;
  elle exige un jeton de vérification email (flux OTP
  `/auth/email/send-otp` → `verify-otp`). L'ancien `/auth/register` sans
  vérification a été supprimé.
- IPN PayDunya : le statut du webhook est systématiquement reconfirmé auprès
  de PayDunya (jamais de confiance au payload).
- Rate-limiting par bucket (Redis partagé si `REDIS_URL` défini) ; les
  GET/HEAD/OPTIONS généraux ne comptent pas dans le bucket général
  (atténuation CGNAT Afrique de l'Ouest).
- `/api/stats`, `/api/users/{user_id}/profile-photo` et `/api/health` :
  requièrent une authentification / ne divulguent plus l'environnement.

## CI

`.github/workflows/ci.yml` : tests backend contre un vrai MongoDB (service
container), syntaxe Python, tests Vitest + build Vite sur Node 24.
