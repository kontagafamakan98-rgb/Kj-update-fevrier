/**
 * PREUVE D'ÉCHEC de `check-funnel-events.js` : chaque refus du garde est
 * éprouvé sur des sources INJECTÉES, et l'arbre RÉEL est jugé tel qu'il est.
 *
 * Ce que la preuve couvre, et par quel chemin :
 *   • l'audit PUR (`auditerSources`, sources injectables) pour chaque refus :
 *     `gtag('event', …)` écrit directement, second propriétaire d'un événement
 *     hors funnel, nom d'événement non déclaré ou calculé, clé absente de la
 *     liste blanche, paramètres non littéraux (`spread`, objet calculé), étape
 *     déclarée sans émetteur, source illisible ou invalide, planchers ;
 *   • l'arbre RÉEL : les cinq étapes ont un émetteur, aucun écart, et le CLI
 *     exécuté en sous-processus sort en 0 en publiant ses cinq lignes.
 *
 * Limite assumée : les planchers sont injectés à 1 dans les cas unitaires — ils
 * protègent le périmètre réel, et les vérifier à chaque cas ferait de chaque
 * refus un test de plancher. Le cas « planchers » les juge pour eux-mêmes.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EVENEMENTS_FUNNEL } from '../../src/utils/funnel.js';
import {
  PLANCHERS,
  auditerSources,
  fichiersSources,
  verifierFunnel,
} from '../check-funnel-events.js';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(ICI, '..');

/** Planchers minimaux : ces cas jugent une RÈGLE, pas le corpus. */
const SANS_PLANCHERS = Object.freeze({ fichiers: 1, appels: 1 });

/** Une page MINIMALE mais conforme : elle émet les cinq étapes, clés déclarées. */
const SOURCE_CONFORME = `
import { EVENEMENTS_FUNNEL, trackFunnel } from '../utils/funnel';

export const a = () => trackFunnel(EVENEMENTS_FUNNEL.inscription, { user_type: 'client' });
export const b = () => trackFunnel(EVENEMENTS_FUNNEL.otpVerifie);
export const c = () => trackFunnel('job_created', { country: 'mali' });
export const d = () => trackFunnel(EVENEMENTS_FUNNEL.propositionEnvoyee);
export const e = () => trackFunnel(EVENEMENTS_FUNNEL.paiementLance, { payment_method: 'wave' });
`;

/** Les sources conformes, une page qui porte les cinq étapes. */
const sources = (extras = {}) => ({ 'pages/Probe.js': SOURCE_CONFORME, ...extras });

const refusDe = (sourcesJugees, options = {}) =>
  auditerSources(sourcesJugees, { planchers: SANS_PLANCHERS, ...options }).refus.join('\n');

/** Une page qui n'émet QUE quatre étapes : la cinquième reste déclarée. */
const sourceSansOtp = () =>
  SOURCE_CONFORME.split('\n')
    .filter((ligne) => !ligne.includes('EVENEMENTS_FUNNEL.otpVerifie'))
    .join('\n');

describe('check-funnel-events — l’arbre réel', () => {
  it('tient : les cinq étapes ont un émetteur, chaque clé est déclarée', () => {
    const { refus, lues, fichiers } = verifierFunnel();

    expect(refus).toEqual([]);
    expect(lues.appels).toBeGreaterThanOrEqual(PLANCHERS.appels);
    expect(fichiers.length).toBeGreaterThanOrEqual(PLANCHERS.fichiers);
    // Chaque étape DÉCLARÉE est réellement émise quelque part : c'est la moitié
    // que le filtre runtime ne peut pas garantir.
    for (const nom of Object.values(EVENEMENTS_FUNNEL)) {
      expect(lues.emetteurs[nom], `« ${nom} » n'a aucun émetteur`).toBeGreaterThan(0);
    }
  });

  it('le CLI réel publie ses cinq étapes et sort en 0', () => {
    const resultat = spawnSync(process.execPath, ['scripts/check-funnel-events.js'], {
      cwd: path.resolve(SCRIPTS, '..'),
      encoding: 'utf8',
    });

    expect(resultat.stderr).toBe('');
    expect(resultat.status).toBe(0);
    for (const nom of Object.values(EVENEMENTS_FUNNEL)) {
      expect(resultat.stdout).toContain(nom);
    }
    expect(resultat.stdout).toContain('✅');
  });
});

describe('check-funnel-events — un `gtag` écrit directement contourne la liste blanche', () => {
  it('refuse `gtag(’event’, …)` dans une page, en nommant le fichier et la sortie', () => {
    const refus = refusDe(
      sources({
        'pages/Detour.js': `
export const pousse = () =>
  window.gtag('event', 'sign_up', { email: 'quelquun@example.com' });
`,
      })
    );

    expect(refus).toContain('pages/Detour.js');
    expect(refus).toContain('DIRECTEMENT');
    // Le remède est nommé, sinon le refus laisse chercher.
    expect(refus).toContain('trackFunnel');
  });

  it('refuse un SECOND propriétaire de `page_view` (l’exception est bornée)', () => {
    const refus = refusDe(
      sources({
        'pages/Vue.js': `
export const pousse = () => gtag('event', 'page_view', {});
`,
        'utils/analytics.js': `
window.gtag('event', 'page_view', { page_path: '/' });
`,
      })
    );

    // `utils/analytics.js` est le propriétaire déclaré : lui seul est toléré,
    // et le refus dit à l'autre fichier À QUI l'événement appartient.
    const lignes = refus.split('\n');
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toContain('pages/Vue.js');
    expect(lignes[0]).toContain('utils/analytics.js');
  });

  it('refuse un événement direct dont le nom n’est pas lisible', () => {
    const refus = refusDe(
      sources({
        'pages/Vue.js': 'export const pousse = (nom) => gtag(\'event\', nom, {});\n',
      })
    );

    expect(refus).toContain('pages/Vue.js');
    expect(refus).toContain('DIRECTEMENT');
  });

  it('laisse passer `gtag(’event’, …)` dans le SEUL fichier qui a le droit d’envoyer', () => {
    const refus = refusDe(
      sources({
        'utils/funnel.js': `
export const trackFunnel = (nom) => window.gtag('event', nom, {});
`,
      })
    );

    expect(refus).toBe('');
  });
});

describe('check-funnel-events — le nom de l’événement', () => {
  it('refuse un nom littéral qui n’est pas déclaré', () => {
    const refus = refusDe(
      sources({
        'pages/Probe.js': SOURCE_CONFORME.replace(
          "trackFunnel('job_created', { country: 'mali' })",
          "trackFunnel('job_created_v2', { country: 'mali' })"
        ),
      })
    );

    expect(refus).toContain('job_created_v2');
    expect(refus).toContain('EVENEMENTS_FUNNEL');
  });

  it('refuse une clé d’étape qui n’existe pas (faute de frappe)', () => {
    const refus = refusDe(
      sources({
        'pages/Probe.js': SOURCE_CONFORME.replace(
          'EVENEMENTS_FUNNEL.inscription',
          'EVENEMENTS_FUNNEL.inscriptions'
        ),
      })
    );

    expect(refus).toContain('« inscriptions »');
    expect(refus).toContain("n'existe pas dans EVENEMENTS_FUNNEL");
  });

  it('refuse un nom calculé : on ne juge pas ce qu’on ne lit pas', () => {
    const refus = refusDe(
      sources({
        'pages/Probe.js': SOURCE_CONFORME.replace(
          'trackFunnel(EVENEMENTS_FUNNEL.propositionEnvoyee)',
          'trackFunnel(nomDynamique)'
        ),
      })
    );

    expect(refus).toContain('calculé');
    // Et l'étape perd son émetteur : les deux refus sont nommés.
    expect(refus).toContain('propositionEnvoyee');
  });
});

describe('check-funnel-events — les clés de paramètres', () => {
  it('refuse une clé absente de CLES_FUNNEL, en la nommant', () => {
    const refus = refusDe(
      sources({
        'pages/Probe.js': SOURCE_CONFORME.replace(
          "{ country: 'mali' }",
          "{ country: 'mali', phone: '+22370000000' }"
        ),
      })
    );

    expect(refus).toContain('phone');
    expect(refus).toContain('CLES_FUNNEL');
  });

  it('refuse un `spread` : une clé illisible peut porter un email', () => {
    const refus = refusDe(
      sources({
        'pages/Probe.js': SOURCE_CONFORME.replace(
          "{ country: 'mali' }",
          '{ ...formulaire }'
        ),
      })
    );

    expect(refus).toContain('spread');
  });

  it('refuse un objet de paramètres non littéral (variable)', () => {
    const refus = refusDe(
      sources({
        'pages/Probe.js': SOURCE_CONFORME.replace(
          "{ payment_method: 'wave' }",
          'parametres'
        ),
      })
    );

    expect(refus).toContain('non littéraux');
  });

  it('accepte une clé calculée à partir d’un littéral de chaîne DÉCLARÉ', () => {
    // `{ 'user_type': … }` écrit en chaîne est la même clé : le refus porte sur
    // les clés ILLISIBLES, pas sur la forme d'écriture.
    const refus = refusDe(
      sources({
        'pages/Probe.js': SOURCE_CONFORME.replace(
          "{ user_type: 'client' }",
          "{ 'user_type': 'client' }"
        ),
      })
    );

    expect(refus).toBe('');
  });
});

describe('check-funnel-events — une étape déclarée sans émetteur', () => {
  it('refuse en nommant l’étape et son nom GA', () => {
    const refus = refusDe(sources({ 'pages/Probe.js': sourceSansOtp() }));

    expect(refus).toContain('otpVerifie');
    expect(refus).toContain('email_otp_verified');
    expect(refus).toContain('SANS AUCUN ÉMETTEUR');
  });

  it('ne compte pas un émetteur écrit dans un TEST', () => {
    // Le périmètre exclut `__tests__` : sinon la preuve d'un événement
    // remplacerait son émetteur, et l'étape pourrait disparaître du produit
    // sans qu'aucun cas ne rougisse.
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-perimetre-'));
    try {
      fs.mkdirSync(path.join(racine, 'pages', '__tests__'), { recursive: true });
      fs.writeFileSync(path.join(racine, 'pages', 'Probe.js'), SOURCE_CONFORME);
      fs.writeFileSync(
        path.join(racine, 'pages', '__tests__', 'Probe.test.js'),
        "trackFunnel(EVENEMENTS_FUNNEL.otpVerifie);\n"
      );

      expect(fichiersSources(racine)).toEqual(['pages/Probe.js']);
    } finally {
      fs.rmSync(racine, { recursive: true, force: true });
    }
  });
});

describe('check-funnel-events — un garde qui ne lit rien ne prouve rien', () => {
  it('refuse sous le plancher de fichiers lus', () => {
    const refus = refusDe(sources(), { planchers: { fichiers: 40, appels: 1 } });

    expect(refus).toContain('sous le plancher 40');
  });

  it('refuse sous le plancher d’appels trouvés', () => {
    const refus = refusDe(sources(), { planchers: { fichiers: 1, appels: 9 } });

    expect(refus).toContain('sous le plancher 9');
  });

  it('refuse une source illisible sans planter', () => {
    const refus = refusDe({ 'pages/Cassée.js': null });

    expect(refus).toContain('pages/Cassée.js');
    expect(refus).toContain('illisible');
  });

  it('refuse une source syntaxiquement invalide', () => {
    const refus = refusDe({ 'pages/Cassée.js': 'export const = ;', 'pages/Probe.js': SOURCE_CONFORME });

    expect(refus).toContain('pages/Cassée.js');
    expect(refus).toContain('illisible');
  });
});
