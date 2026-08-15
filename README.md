# Kojo — Plateforme de mise en relation artisans / clients

Kojo connecte clients et artisans en Afrique de l'Ouest (Sénégal, Mali, Côte d'Ivoire, Burkina Faso). Paiement sécurisé via PayDunya (Orange Money, Wave, carte bancaire).

## Stack technique

| Couche | Technologies |
|---|---|
| Frontend | React 18, Vite, Tailwind CSS |
| Backend | Python 3.11, FastAPI, Motor (MongoDB async) |
| Base de données | MongoDB Atlas |
| Paiements | PayDunya (Orange Money, Wave, carte) |
| Photos | Cloudinary |
| Emails | Brevo / Gmail OAuth2 |
| Notifications push | VAPID (pywebpush) |
| Déploiement | Render (backend) + Vercel (frontend) |

## Setup local

### Backend
```bash
cd backend
cp .env.example .env        # Remplir les valeurs
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

### Frontend
```bash
cd frontend
cp .env.example .env.local  # Adapter VITE_API_URL si besoin
npm install
npm run dev
```

### Tests
```bash
cd backend && python -m pytest tests/ -v
```

## Déploiement

**Backend (Render)** — Web Service Python  
Start command : `uvicorn server:app --host 0.0.0.0 --port $PORT`  
Variables d'env → voir `backend/.env.example`

**Frontend (Vercel)** — Framework Vite, output `frontend/build`  
Variables d'env → voir `frontend/.env.example`

## Structure
```
├── backend/
│   ├── server.py        # API FastAPI
│   ├── requirements.txt
│   ├── .env.example     # Toutes les variables documentées
│   └── tests/           # 58 tests pytest
├── frontend/
│   ├── src/             # React (pages, components, services, contexts)
│   ├── public/          # Assets + icônes PWA
│   └── .env.example
└── .github/workflows/   # CI (tests + build)
```
