import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// ─── Fixtures temporaires : l'audit est exécuté en sous-processus avec les
// répertoires surchargés par env (KOJO_AUDIT_SERVICES_DIR / _BACKEND_DIR) —
// c'est le script RÉEL qu'on teste, pas une réimplémentation.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'audit_api_returns.cjs');

const tempDirs = [];

function makeFixture({ backendPy, serviceJs }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kojo-audit-'));
  tempDirs.push(base);
  const backendDir = path.join(base, 'backend');
  const servicesDir = path.join(base, 'services');
  fs.mkdirSync(backendDir);
  fs.mkdirSync(servicesDir);
  fs.writeFileSync(path.join(backendDir, 'kojo_routers_fixture.py'), backendPy);
  fs.writeFileSync(path.join(servicesDir, 'probeService.js'), serviceJs);
  return { backendDir, servicesDir };
}

function runAudit({ backendDir, servicesDir, strict = true }) {
  const res = spawnSync(process.execPath, [SCRIPT, ...(strict ? ['--fail-on-warning'] : [])], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KOJO_AUDIT_BACKEND_DIR: backendDir,
      KOJO_AUDIT_SERVICES_DIR: servicesDir,
    },
  });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Backend : une route métier GET /jobs + un health check infra GET/HEAD.
const BACKEND_FIXTURE = `
from fastapi import APIRouter, FastAPI
router = APIRouter()
app = FastAPI()

@router.get("/jobs")
async def get_jobs():
    return {"jobs": []}

@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "healthy"}
`;

describe('audit_api_returns.cjs — les quatre sorties du CONTRAT', () => {
  it('PASSE : bon verbe sur une route existante → exit 0', () => {
    const fx = makeFixture({
      backendPy: BACKEND_FIXTURE,
      serviceJs: `
import { api } from './api';

export const probeService = {
  /** @returns {Promise<object>} Liste des missions. */
  fetchJobs: () => api.get('/jobs'),
};
`,
    });
    const { code, stdout } = runAudit(fx);
    expect(code).toBe(0);
    expect(stdout).toContain('[OK]');
    expect(stdout).not.toContain('[ECHEC]');
  });

  it('ERREUR MÉTIER : verbe interdit sur route métier → exit 1 (bloquant même en défaut)', () => {
    const fx = makeFixture({
      backendPy: BACKEND_FIXTURE,
      serviceJs: `
import { api } from './api';

export const probeService = {
  /** @returns {Promise<object>} Tentative POST sur GET /jobs. */
  createJob: () => api.post('/jobs'),
};
`,
    });
    const { code, stdout } = runAudit(fx);
    expect(code).toBe(1);
    expect(stdout).toContain('[ECHEC]');
    expect(stdout).toContain('verbe non autorisé');
    expect(stdout).toContain('autorisés: GET');

    // Même sans --fail-on-warning, une erreur métier bloque toujours.
    const lax = runAudit({ ...fx, strict: false });
    expect(lax.code).toBe(1);
  });

  it('WARNING INFRA : verbe interdit sur /health → non bloquant en défaut (exit 0)', () => {
    const fx = makeFixture({
      backendPy: BACKEND_FIXTURE,
      serviceJs: `
import { api } from './api';

export const probeService = {
  /** @returns {Promise<object>} POST sur health (hors périmètre). */
  postHealth: () => api.post('/health'),
};
`,
    });
    const lax = runAudit({ ...fx, strict: false });
    expect(lax.code).toBe(0);
    expect(lax.stdout).toContain('[AVERTISSEMENT]');
    expect(lax.stdout).toContain('hors périmètre');
  });

  it('STRICT BLOQUANT : le même warning infra fait échouer avec --fail-on-warning (exit 1)', () => {
    const fx = makeFixture({
      backendPy: BACKEND_FIXTURE,
      serviceJs: `
import { api } from './api';

export const probeService = {
  /** @returns {Promise<object>} POST sur health (hors périmètre). */
  postHealth: () => api.post('/health'),
};
`,
    });
    const strict = runAudit(fx); // strict = true par défaut
    expect(strict.code).toBe(1);
    expect(strict.stdout).toContain('[ECHEC] Mode strict');
  });
});

describe('audit_api_returns.cjs — cas limites du CONTRAT', () => {
  it('ERREUR MÉTIER : route introuvable (chemin inexistant) → exit 1', () => {
    const fx = makeFixture({
      backendPy: BACKEND_FIXTURE,
      serviceJs: `
import { api } from './api';

export const probeService = {
  /** @returns {Promise<object>} Appel vers un endpoint inexistant. */
  fetchMissing: () => api.get('/totally/missing'),
};
`,
    });
    const { code, stdout } = runAudit(fx);
    expect(code).toBe(1);
    expect(stdout).toContain('route introuvable');
  });

  it('ERREUR MÉTIER : api_route à methods explicites (GET/HEAD) rejette POST hors liste', () => {
    const fx = makeFixture({
      backendPy: `
from fastapi import FastAPI
app = FastAPI()

@app.api_route("/monitor/paydunya", methods=["GET", "HEAD"])
async def monitor_paydunya():
    return {"circuit": "ok"}
`,
      serviceJs: `
import { api } from './api';

export const probeService = {
  /** @returns {Promise<object>} Tentative POST sur GET/HEAD. */
  postState: () => api.post('/monitor/paydunya'),
};
`,
    });
    const { code, stdout } = runAudit(fx);
    expect(code).toBe(1); // strict par défaut → warning infra bloquant
    expect(stdout).toContain('verbe non autorisé');
    expect(stdout).toContain('GET, HEAD');
    expect(stdout).toContain('hors périmètre');
  });
});
