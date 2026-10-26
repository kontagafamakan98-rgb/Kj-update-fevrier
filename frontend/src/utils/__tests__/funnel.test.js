/**
 * FUNNEL — la LISTE BLANCHE des clés, et le refus de tout ce qui n'y est pas.
 *
 * Ces cas ne jugent pas « l'événement part » (le garde statique
 * `scripts/check-funnel-events.js` vérifie qu'il est émis depuis la bonne page) :
 * ils jugent ce qui SORT. C'est la moitié que personne ne relit après coup — un
 * paramètre de trop dans un rapport d'audience ne se retire pas, et le
 * consentement ne couvre pas ce qu'on n'avait pas annoncé.
 *
 * Ce que chaque cas empêche, dans l'ordre :
 *   1. un envoi sans mesure configurée (pas de consentement → pas de `gtag`) ;
 *   2. qu'un identifiant (email, nom, identifiant de mission) accompagne une
 *      étape simplement parce que l'appelant avait l'objet sous la main ;
 *   3. qu'une valeur libre crée une série par valeur (`'Wave'` contre `'wave'`) ;
 *   4. qu'un nom d'événement inventé dans une page atterrisse dans GA ;
 *   5. que la déclaration elle-même dérive (nom invalide pour GA, doublon, clé
 *      sans règle de validation).
 */
import { describe, expect, it, vi } from 'vitest';

import { CLES_FUNNEL, EVENEMENTS_FUNNEL, trackFunnel } from '../funnel.js';
import { PAYS_KOJO } from '../countryAliases.js';

const NOMS_DECLARES = Object.values(EVENEMENTS_FUNNEL);

/** Installe un `gtag` espion et rend ses appels. */
const avecGtag = () => {
  const gtag = vi.fn();
  window.gtag = gtag;
  return gtag;
};

const sansGtag = () => {
  delete window.gtag;
};

/** Les couples (nom, paramètres) transmis à `gtag('event', …)`. */
const envois = (gtag) =>
  gtag.mock.calls.map(([commande, nom, parametres]) => ({ commande, nom, parametres }));

describe('trackFunnel — aucun envoi sans mesure configurée', () => {
  it('ne fait rien et ne lève pas quand `gtag` n’existe pas (pas de consentement, pas d’ID)', () => {
    sansGtag();
    expect(() => trackFunnel(EVENEMENTS_FUNNEL.inscription, { user_type: 'client' })).not.toThrow();
    expect(trackFunnel(EVENEMENTS_FUNNEL.inscription, { user_type: 'client' })).toBe(false);
    expect(window.gtag).toBeUndefined();
  });

  it('rend `true` quand l’événement est réellement remis à `gtag`', () => {
    const gtag = avecGtag();
    expect(trackFunnel(EVENEMENTS_FUNNEL.propositionEnvoyee)).toBe(true);
    expect(envois(gtag)).toEqual([
      { commande: 'event', nom: 'proposal_sent', parametres: {} },
    ]);
    sansGtag();
  });
});

describe('trackFunnel — rien ne sort sans être déclaré', () => {
  it('écarte un IDENTIFIANT même quand l’appelant le fournit', () => {
    const gtag = avecGtag();
    trackFunnel(EVENEMENTS_FUNNEL.inscription, {
      user_type: 'worker',
      email: 'quelquun@example.com',
      name: 'Fatoumata Traoré',
      job_id: 'job-42',
      proposal_id: 'p-7',
    });

    // Un seul envoi, et il ne porte QUE la clé déclarée.
    expect(envois(gtag)).toHaveLength(1);
    expect(envois(gtag)[0].parametres).toEqual({ user_type: 'worker' });
    expect(JSON.stringify(gtag.mock.calls)).not.toMatch(/example\.com|Fatoumata|job-42/);
    sansGtag();
  });

  it('normalise la casse d’une valeur d’énumération, pour ne pas créer deux séries', () => {
    const gtag = avecGtag();
    trackFunnel(EVENEMENTS_FUNNEL.paiementLance, { payment_method: '  Wave ' });
    expect(envois(gtag)[0].parametres).toEqual({ payment_method: 'wave' });
    sansGtag();
  });

  it('écarte une valeur HORS liste au lieu de la corriger en une autre', () => {
    const gtag = avecGtag();
    trackFunnel(EVENEMENTS_FUNNEL.paiementLance, { payment_method: 'bitcoin' });
    expect(envois(gtag)[0].parametres).toEqual({});
    sansGtag();
  });

  it('borne le pays à ceux du produit, sans accepter n’importe quel code', () => {
    const gtag = avecGtag();
    trackFunnel(EVENEMENTS_FUNNEL.missionCreee, { country: 'MALI' });
    trackFunnel(EVENEMENTS_FUNNEL.missionCreee, { country: 'atlantide' });
    trackFunnel(EVENEMENTS_FUNNEL.missionCreee, { country: 'FR' });

    expect(envois(gtag).map((envoi) => envoi.parametres)).toEqual([
      { country: 'mali' },
      {},
      {},
    ]);
    sansGtag();
  });

  it('n’accepte un booléen que comme booléen (jamais la chaîne « true »)', () => {
    const gtag = avecGtag();
    trackFunnel(EVENEMENTS_FUNNEL.inscription, { has_referral: true });
    trackFunnel(EVENEMENTS_FUNNEL.inscription, { has_referral: 'true' });
    trackFunnel(EVENEMENTS_FUNNEL.inscription, { has_referral: 1 });

    expect(envois(gtag).map((envoi) => envoi.parametres)).toEqual([
      { has_referral: true },
      {},
      {},
    ]);
    sansGtag();
  });

  it('refuse un nom d’événement non déclaré — rien n’est remis à `gtag`', () => {
    const gtag = avecGtag();
    expect(trackFunnel('signup')).toBe(false);
    expect(trackFunnel('')).toBe(false);
    expect(trackFunnel(undefined)).toBe(false);
    expect(gtag).not.toHaveBeenCalled();
    sansGtag();
  });

  it('appelé sans paramètres, publie l’étape les mains vides (pas d’objet `undefined`)', () => {
    const gtag = avecGtag();
    trackFunnel(EVENEMENTS_FUNNEL.propositionEnvoyee, undefined);
    expect(envois(gtag)[0].parametres).toEqual({});
    sansGtag();
  });
});

describe('la déclaration elle-même', () => {
  it('déclare six étapes distinctes, aux noms valides pour GA4', () => {
    // Cinq étapes d'ENTONNOIR, plus `job_shared` — le partage d'une mission,
    // hors entonnoir mais soumis à la même liste blanche (le canal seul sort).
    expect(NOMS_DECLARES).toHaveLength(6);
    expect(new Set(NOMS_DECLARES).size).toBe(6);
    for (const nom of NOMS_DECLARES) {
      // Un nom GA4 : minuscules, chiffres et `_`, commençant par une lettre.
      expect(nom, `« ${nom} » n'est pas un nom d'événement GA4`).toMatch(/^[a-z][a-z0-9_]{2,39}$/);
    }
  });

  it('garde les deux noms RECOMMANDÉS par GA4 (rapports d’entonnoir intégrés)', () => {
    // Les renommer ne casserait aucun test de comportement, mais priverait GA
    // de ses rapports d'entonnoir : c'est une décision, donc elle est verrouillée.
    expect(NOMS_DECLARES).toContain('sign_up');
    expect(NOMS_DECLARES).toContain('begin_checkout');
  });

  it('déclare le PARTAGE hors entonnoir, avec le seul canal comme dimension', () => {
    // Le partage n'est pas une étape d'installation : il fait entrer du trafic
    // par WhatsApp. Ce qui sort est le CANAL, jamais l'identifiant de la
    // mission ni le titre — une valeur libre créerait une série par valeur.
    expect(EVENEMENTS_FUNNEL.partageMission).toBe('job_shared');
    expect(CLES_FUNNEL.channel).toEqual(['whatsapp', 'natif']);
  });

  it('donne à chaque clé une règle de validation bornée', () => {
    for (const [cle, regle] of Object.entries(CLES_FUNNEL)) {
      const bornee = Array.isArray(regle) ? regle.length > 0 : regle === 'booleen';
      expect(bornee, `la clé « ${cle} » n'a pas de règle bornée`).toBe(true);
    }
  });

  it('n’ouvre aucune clé d’identifiant ni de texte libre', () => {
    for (const interdite of ['email', 'name', 'id', 'job_id', 'proposal_id', 'message', 'title', 'amount']) {
      expect(Object.prototype.hasOwnProperty.call(CLES_FUNNEL, interdite)).toBe(false);
    }
  });

  it('tient la liste des pays sur la déclaration du produit, sans troisième copie', () => {
    // La valeur admise EST `PAYS_KOJO` (utils/countryAliases.js) : si un pays
    // est ajouté là-bas, il n'est pas publié par oubli, il l'est parce que la
    // dimension est déclarée. Et une copie locale divergerait en silence.
    expect(CLES_FUNNEL.country).toBe(PAYS_KOJO);
  });
});
