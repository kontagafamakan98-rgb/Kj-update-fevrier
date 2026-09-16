import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { structuralFallbackCheck } from '../validate-vercel-json.mjs';

// vercel.json RÉEL du projet (celui déployé par Vercel), pas un fixture.
const REAL_VERCEL_JSON = JSON.parse(
  readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../vercel.json'),
    'utf8'
  )
);

describe('structuralFallbackCheck (repli hors-ligne du validateur vercel.json)', () => {
  it('accepte un vercel.json valide (structure actuelle du projet)', () => {
    const errors = structuralFallbackCheck({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      framework: 'vite',
      outputDirectory: 'build',
      rewrites: [
        { source: '/api/:path*', destination: 'https://kojo-backend.fly.dev/api/:path*' },
        { source: '/(.*)', destination: '/index.html' },
      ],
      headers: [
        { source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }] },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('rejette un rewrite avec la propriété headers (régression du build Vercel)', () => {
    const errors = structuralFallbackCheck({
      rewrites: [
        {
          source: '/api/:path*',
          destination: 'https://kojo-backend.fly.dev/api/:path*',
          headers: [{ key: 'X-Forwarded-Host', value: '$host' }],
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].instancePath).toBe('/rewrites/0/headers');
  });

  it('accepte les clés autorisées has/missing dans un rewrite', () => {
    const errors = structuralFallbackCheck({
      rewrites: [
        {
          source: '/old/:path*',
          destination: '/new/:path*',
          has: [{ type: 'header', key: 'x-vercel-ip-country', value: 'GB' }],
        },
      ],
    });
    expect(errors).toEqual([]);
  });

  it('rejette une règle headers sans champ headers (tableau)', () => {
    const errors = structuralFallbackCheck({
      headers: [{ source: '/index.html' }],
    });
    expect(errors.some((e) => e.instancePath === '/headers/0')).toBe(true);
  });

  it('rejette un header sans key/value string', () => {
    const errors = structuralFallbackCheck({
      headers: [{ source: '/x', headers: [{ key: 42, value: null }] }],
    });
    expect(errors.some((e) => e.instancePath === '/headers/0/headers/0')).toBe(true);
  });

  it('rejette un rewrite sans destination string', () => {
    const errors = structuralFallbackCheck({
      rewrites: [{ source: '/api/:path*', destination: 123 }],
    });
    expect(errors.some((e) => e.instancePath === '/rewrites/0')).toBe(true);
  });

  it('rejette un fichier racine non-objet', () => {
    expect(structuralFallbackCheck('nope')).not.toEqual([]);
    expect(structuralFallbackCheck(null)).not.toEqual([]);
  });
});

describe('vercel.json RÉEL : rewrite du pré-rendu des fiches /jobs/:id', () => {
  it('aiguille /jobs/(.*) vers le BACKEND (og HTML) APRÈS /jobs et /jobs/, et AVANT le proxy /api/:path*', () => {
    const rewrites = REAL_VERCEL_JSON.rewrites || [];
    const idxOg = rewrites.findIndex((r) => r && r.source === '/jobs/(.*)');
    const idxProxy = rewrites.findIndex((r) => r && r.source === '/api/:path*');
    const idxJobs = rewrites.findIndex((r) => r && r.source === '/jobs');
    const idxJobsSlash = rewrites.findIndex((r) => r && r.source === '/jobs/');

    // Les fiches sont pré-rendues par le BACKEND (GET /api/og/jobs/{id},
    // kojo_routers_public.py) — plus de fonction serverless Vercel (jamais
    // déployée en mode outputDirectory statique).
    expect(idxOg).toBeGreaterThanOrEqual(0);
    expect(rewrites[idxOg].destination).toBe('https://kojo-backend.fly.dev/api/og/jobs/$1');
    // /jobs et /jobs/ AVANT le motif : « /jobs/(.*) » capture aussi « /jobs/ »
    // (le groupe peut être vide) — placées après, ces deux règles étaient
    // inatteignables et /jobs/ répondait 404 en JSON (mesuré en production).
    expect(idxJobs).toBeGreaterThanOrEqual(0);
    expect(idxJobsSlash).toBeGreaterThanOrEqual(0);
    expect(idxJobs).toBeLessThan(idxOg);
    expect(idxJobsSlash).toBeLessThan(idxOg);
    // Le rewrite précède le proxy /api/:path* (aucune règle ne capture le
    // chemin avant lui)…
    expect(idxProxy).toBeGreaterThanOrEqual(0);
    expect(idxOg).toBeLessThan(idxProxy);
    // …et AUCUN catch-all ne masque la fiche : il rendrait 200 + index.html
    // (mauvaise carte OG) ET ferait répondre 200 aux URL inconnues.
    expect(rewrites.findIndex((r) => r && r.source === '/(.*)')).toBe(-1);
  });

  it('le vercel.json réel passe le repli structurel (aucune clé interdite)', () => {
    const errors = structuralFallbackCheck(REAL_VERCEL_JSON);
    expect(errors).toEqual([]);
  });
});
