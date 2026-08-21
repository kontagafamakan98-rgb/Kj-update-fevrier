import { describe, it, expect } from 'vitest';
import { structuralFallbackCheck } from '../validate-vercel-json.mjs';

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
