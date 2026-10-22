/**
 * Preuve de la RÈGLE de lecture et de comparaison d'une CSP
 * (`frontend/scripts/csp-document.js`).
 *
 * Deux lecteurs s'en servent — le contrat hors ligne et la sonde de production.
 * Les cas ci-dessous sont ceux qui font la différence entre « le document est
 * muet » et « le document dit autre chose » : une règle qui confondrait les deux
 * enverrait corriger le mauvais fichier, ou pire, lirait une politique absente
 * comme une politique conforme.
 */
import { describe, it, expect } from 'vitest';

import {
  DIRECTIVE_ENTETE,
  cspDeDocument,
  decoderEntites,
  directivesDe,
  ecartsDePolitiques,
} from '../csp-document.js';

const POLITIQUE =
  "default-src 'self'; script-src 'self' https://accounts.google.com; " +
  "img-src 'self' data: https://res.cloudinary.com; connect-src 'self' https://api.kojo.test";

const meta = (csp, { entetes = '"', ordre = 'normal' } = {}) => {
  const attributs =
    ordre === 'inverse'
      ? `content=${entetes}${csp}${entetes} http-equiv="Content-Security-Policy"`
      : `http-equiv="Content-Security-Policy" content=${entetes}${csp}${entetes}`;
  return `<html><head><meta ${attributs} /></head></html>`;
};

describe('csp-document — lire la politique d’un document', () => {
  it('lit la balise quel que soit l’ordre des attributs', () => {
    expect(cspDeDocument(meta(POLITIQUE))).toBe(POLITIQUE);
    expect(cspDeDocument(meta(POLITIQUE, { ordre: 'inverse' }))).toBe(POLITIQUE);
  });

  it('accepte les guillemets simples', () => {
    // Une politique sans apostrophe : dans un attribut entre guillemets simples,
    // une apostrophe fermerait la valeur (c'est pour cela que le backend écrit
    // toujours des guillemets doubles).
    const sansApostrophe = 'default-src none; object-src none';
    expect(cspDeDocument(meta(sansApostrophe, { entetes: "'" }))).toBe(sansApostrophe);
  });

  it('ignore les autres metas et rend VIDE quand la CSP est absente', () => {
    expect(cspDeDocument('<meta name="robots" content="index" />')).toBe('');
    expect(cspDeDocument('<meta property="og:title" content="t" />')).toBe('');
    expect(cspDeDocument('')).toBe('');
    expect(cspDeDocument(undefined)).toBe('');
  });

  it('distingue une balise VIDE d’une balise absente (les deux valent "")', () => {
    expect(cspDeDocument('<meta http-equiv="Content-Security-Policy" content="" />')).toBe('');
  });

  it('lit la CSP même si une autre meta la précède', () => {
    const html =
      '<meta charset="utf-8" /><meta name="description" content="d" />' + meta(POLITIQUE);
    expect(cspDeDocument(html)).toBe(POLITIQUE);
  });

  it('décode l’échappement d’attribut (le backend n’échappe pas l’apostrophe)', () => {
    expect(decoderEntites('a &amp; b &quot;c&quot; &apos;d&apos;')).toBe('a & b "c" \'d\'');
    // Le `&amp;` est décodé en DERNIER : un `&amp;quot;` littéral ne devient pas `"`.
    expect(decoderEntites('&amp;quot;')).toBe('&quot;');
    // Le backend échappe `"` mais laisse `'` : la politique doit se relire intacte.
    const echappee = POLITIQUE.replace(/"/g, '&quot;');
    expect(cspDeDocument(meta(echappee))).toBe(POLITIQUE);
  });
});

describe('csp-document — découper une politique', () => {
  it('rend les directives dans l’ordre, avec leurs sources', () => {
    expect(directivesDe(POLITIQUE)).toEqual([
      { nom: 'default-src', sources: ["'self'"] },
      { nom: 'script-src', sources: ["'self'", 'https://accounts.google.com'] },
      { nom: 'img-src', sources: ["'self'", 'data:', 'https://res.cloudinary.com'] },
      { nom: 'connect-src', sources: ["'self'", 'https://api.kojo.test'] },
    ]);
  });

  it('rend une liste vide pour une politique vide', () => {
    expect(directivesDe('')).toEqual([]);
    expect(directivesDe(undefined)).toEqual([]);
  });
});

describe('csp-document — les écarts entre deux politiques', () => {
  it('n’en trouve aucun entre deux politiques identiques', () => {
    expect(ecartsDePolitiques({ attendue: POLITIQUE, servie: POLITIQUE })).toEqual([]);
  });

  it('nomme une directive ABSENTE du document', () => {
    const servie = POLITIQUE.split('; ')
      .filter((partie) => !partie.startsWith('img-src'))
      .join('; ');
    const ecarts = ecartsDePolitiques({ attendue: POLITIQUE, servie });

    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toContain('« img-src » est ABSENTE');
    expect(ecarts[0]).toContain('https://res.cloudinary.com');
  });

  it('nomme une SOURCE qui manque au document', () => {
    const servie = POLITIQUE.replace(' https://accounts.google.com', '');
    const ecarts = ecartsDePolitiques({ attendue: POLITIQUE, servie });

    expect(ecarts[0]).toContain("« script-src » n'autorise pas https://accounts.google.com");
  });

  it('nomme une source AUTORISÉE EN PLUS par le document', () => {
    const servie = POLITIQUE.replace(
      "connect-src 'self'",
      "connect-src 'self' https://cdn.pirate.test"
    );
    const ecarts = ecartsDePolitiques({ attendue: POLITIQUE, servie });

    expect(ecarts[0]).toContain('autorise en plus https://cdn.pirate.test');
  });

  it('nomme une directive qui n’existe QUE dans le document', () => {
    const servie = `${POLITIQUE}; report-uri https://collecte.test`;
    const ecarts = ecartsDePolitiques({ attendue: POLITIQUE, servie });

    expect(ecarts[0]).toContain('« report-uri » n\'existe QUE dans le document');
  });

  it('refuse les mêmes directives dans un autre ORDRE (ce ne sont pas les mêmes octets)', () => {
    const morceaux = POLITIQUE.split('; ');
    const servie = [morceaux[0], ...morceaux.slice(1).reverse()].join('; ');
    const ecarts = ecartsDePolitiques({ attendue: POLITIQUE, servie });

    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toContain('la politique n’est pas la MÊME CHAÎNE');
  });

  it('refuse de comparer à une politique vide, dans les deux sens', () => {
    expect(ecartsDePolitiques({ attendue: '', servie: POLITIQUE })[0]).toContain(
      'la politique de référence est VIDE'
    );
    expect(ecartsDePolitiques({ attendue: POLITIQUE, servie: '' })[0]).toContain(
      'la politique jugée est VIDE'
    );
  });

  it('publie `frame-ancestors` comme une directive à part entière', () => {
    // La règle ne la filtre PAS : c'est le contrat qui refuse qu'elle soit dans
    // une meta (les navigateurs l'ignorent). Ici, elle doit donc se VOIR.
    const servie = `${POLITIQUE}; ${DIRECTIVE_ENTETE} 'none'`;
    expect(ecartsDePolitiques({ attendue: POLITIQUE, servie })[0]).toContain(DIRECTIVE_ENTETE);
  });
});
