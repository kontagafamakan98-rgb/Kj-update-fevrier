/**
 * Preuve de la règle « après le geste, il ne sort QUE ce qui est autorisé » —
 * le module que la sonde Chromium (`e2e/tiers-apres-interaction.spec.js`)
 * exécute.
 *
 * Ce fichier ne remplace pas le parcours : il fixe le CONTRAT que le parcours
 * applique (quelle adresse est autorisée, comment un refus se nomme, ce qui fait
 * lever la règle) et il vérifie les trois propriétés qui feraient d'un vert un
 * faux vert :
 *
 *   • l'autorisation est une ADRESSE, pas une famille d'hôtes — sinon elle
 *     laisserait passer toute adresse Google, et ne dirait pas ce qu'elle
 *     autorise ;
 *   • une autorisation ne vaut que pour SON geste — un tiers vu après un autre
 *     geste est un refus, jamais un oubli ;
 *   • l'autorisation NOMME son propriétaire, et ce propriétaire existe : un nom
 *     de fichier périmé ferait pointer la règle vers du vide.
 *
 * Les deux règles partagent `estTiers` et `nommerInitiateur` : elles ne peuvent
 * donc pas diverger sur QUI est tiers, et le dernier cas le mesure au lieu de le
 * supposer.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONTACT } from '../../src/config/contact.js';
import { divergencesDeTiers } from '../tiers-avant-interaction.js';
import {
  CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR,
  INTERACTIONS,
  NOMS_DES_INTERACTIONS,
  PROPRIETAIRE_DE_LA_CARTE,
  autorisationsDe,
  estRequeteDAPI,
  jugerApresInteraction,
  memeAdresse,
} from '../tiers-apres-interaction.js';

const PAGE = 'http://127.0.0.1:4173';
const CARTE = CONTACT.mapsEmbedUrl;
/** La racine du frontend, comme dans les autres preuves de ce dossier. */
const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Une requête de carte, telle que le CDP la voit à l'appui. */
const requeteDeCarte = (url = CARTE) => ({
  url,
  sorte: 'Document',
  initiateur: { type: 'script', url: `${PAGE}/assets/index-abc.js`, lineNumber: 42 },
});

describe('tiers après interaction — ce qui est autorisé, et ce qui ne l’est pas', () => {
  it('autorise l’adresse DÉCLARÉE, et la nomme (URL, sorte, initiateur, propriétaire)', () => {
    const verdict = jugerApresInteraction([requeteDeCarte()], {
      interaction: 'ouvrir-la-carte',
      origineDeLaPage: PAGE,
    });

    expect(verdict.refusees).toEqual([]);
    expect(verdict.autorisees).toEqual([
      {
        url: CARTE,
        sorte: 'Document',
        initiateur: `un script ${PAGE}/assets/index-abc.js:42`,
        proprietaire: PROPRIETAIRE_DE_LA_CARTE,
      },
    ]);
  });

  it('l’autorisation vient de contact.json — elle n’est pas recopiée', () => {
    expect(INTERACTIONS['ouvrir-la-carte'].autorisations[0].url).toBe(CONTACT.mapsEmbedUrl);
    expect(INTERACTIONS['ouvrir-la-carte'].autorisations).toHaveLength(1);
  });

  it('elle nomme un propriétaire QUI EXISTE : une autorisation ne pointe pas vers du vide', () => {
    const fichier = path.join(FRONTEND, PROPRIETAIRE_DE_LA_CARTE);
    expect(existsSync(fichier), `${PROPRIETAIRE_DE_LA_CARTE} n’existe pas (${fichier})`).toBe(true);
  });

  it('une adresse VOISINE du même hôte est refusée : l’autorisation est une adresse, pas une famille', () => {
    const voisines = [
      'https://www.google.com/maps/api/staticmap?center=Bamako&zoom=12',
      'https://maps.googleapis.com/maps/api/js?key=essai',
      'https://www.gstatic.com/maps/quelque-chose.png',
      'https://fonts.googleapis.com/css2?family=Roboto',
    ];
    for (const url of voisines) {
      const verdict = jugerApresInteraction([requeteDeCarte(url)], {
        interaction: 'ouvrir-la-carte',
        origineDeLaPage: PAGE,
      });
      expect(verdict.autorisees, `« ${url} » ne doit PAS être autorisée`).toEqual([]);
      expect(verdict.refusees.map((r) => r.url)).toEqual([url]);
    }
  });

  it('une adresse de carte qui n’est pas l’embed déclaré est refusée (même hôte, autre chemin)', () => {
    const presque = CARTE.replace('&output=embed', '');
    expect(memeAdresse(presque, CARTE)).toBe(false);
    const verdict = jugerApresInteraction([requeteDeCarte(presque)], {
      interaction: 'ouvrir-la-carte',
      origineDeLaPage: PAGE,
    });
    expect(verdict.refusees.map((r) => r.url)).toEqual([presque]);
  });

  it('un tiers quelconque, vu après le geste, est refusé et NOMMÉ', () => {
    const verdict = jugerApresInteraction(
      [
        requeteDeCarte(),
        {
          url: 'https://analytics.example/collect',
          sorte: 'Fetch',
          initiateur: { type: 'script', url: `${PAGE}/assets/index-abc.js`, lineNumber: 9 },
        },
      ],
      { interaction: 'ouvrir-la-carte', origineDeLaPage: PAGE }
    );
    expect(verdict.autorisees.map((a) => a.url)).toEqual([CARTE]);
    expect(verdict.refusees).toEqual([
      {
        url: 'https://analytics.example/collect',
        sorte: 'Fetch',
        initiateur: `un script ${PAGE}/assets/index-abc.js:9`,
      },
    ]);
  });

  it('un initiateur que le protocole ne remplit pas est nommé par le DOCUMENT demandeur', () => {
    // Mesuré en navigateur : pour une iframe montée par un script, Chromium
    // n'envoie que `{"type":"other"}`. Le document demandeur, lui, est un fait —
    // et c'est ce que le verdict publie, au lieu d'un « inconnu » qui
    // n'apprendrait rien.
    const verdict = jugerApresInteraction(
      [{ url: 'https://analytics.example/collect', sorte: 'Document', initiateur: { type: 'other' } }],
      { interaction: 'ouvrir-la-carte', origineDeLaPage: PAGE }
    );
    expect(verdict.refusees[0].initiateur).toBe(`le document ${PAGE}`);

    // Et quand le cadre relevé dit MIEUX que l'origine de la page (la requête
    // part d'un cadre enfant), c'est LUI qui est nommé.
    const depuisUnCadre = jugerApresInteraction(
      [{ url: 'https://analytics.example/collect', initiateur: { type: 'other' }, cadre: `${PAGE}/contact` }],
      { interaction: 'ouvrir-la-carte', origineDeLaPage: PAGE }
    );
    expect(depuisUnCadre.refusees[0].initiateur).toBe(`le document ${PAGE}/contact`);
  });

  it('une sorte INFORMATIVE n’est jamais écrasée par le document demandeur', () => {
    // « l'analyseur HTML » dit mieux que le document : le remplacer ferait
    // reculer les verdicts déjà écrits (le parcours d'avant exige que le tiers
    // DÉCLARÉ dans une coquille soit nommé par l'analyseur).
    const verdict = jugerApresInteraction(
      [{ url: 'https://cdn.test/declare.js', sorte: 'Script', initiateur: { type: 'parser' } }],
      { interaction: 'ouvrir-la-carte', origineDeLaPage: PAGE }
    );
    expect(verdict.refusees[0].initiateur).toBe('l’analyseur HTML');
  });

  it('sans rien du tout, il est dit honnêtement « inconnu »', () => {
    const verdict = jugerApresInteraction([{ url: 'https://analytics.example/collect' }], {
      interaction: 'ouvrir-la-carte',
    });
    expect(verdict.refusees[0].initiateur).toBe('initiateur inconnu');
    expect(verdict.refusees[0].sorte).toBe('requête');
  });
});

describe('tiers après interaction — nos requêtes, rendues à part', () => {
  it('l’API et nos origines ne sont ni autorisées ni refusées : elles sont NOMMÉES', () => {
    const verdict = jugerApresInteraction(
      [
        {
          url: 'http://127.0.0.1:8123/api/jobs?q=kojo-sonde',
          sorte: 'Fetch',
          initiateur: { type: 'script', url: `${PAGE}/assets/index-abc.js`, lineNumber: 5 },
        },
        { url: `${PAGE}/assets/index-abc.js`, sorte: 'Script', initiateur: { type: 'parser' } },
      ],
      { interaction: 'chercher-une-mission', origineDeLaPage: PAGE }
    );
    expect(verdict.autorisees).toEqual([]);
    expect(verdict.refusees).toEqual([]);
    expect(verdict.notres.map((r) => r.url)).toEqual([
      'http://127.0.0.1:8123/api/jobs?q=kojo-sonde',
      `${PAGE}/assets/index-abc.js`,
    ]);
    // …et le plancher de lecture du cas d'appel d'API sait les reconnaître.
    expect(verdict.notres.some((r) => estRequeteDAPI(r.url))).toBe(true);
    expect(estRequeteDAPI(`${PAGE}/assets/index-abc.js`)).toBe(false);
  });

  it('le geste « chercher-une-mission » n’autorise RIEN — et c’est une affirmation', () => {
    expect(INTERACTIONS['chercher-une-mission'].autorisations).toEqual([]);
    const verdict = jugerApresInteraction(
      [{ url: 'https://cdn.test/lib.js', sorte: 'Script', initiateur: { type: 'parser' } }],
      { interaction: 'chercher-une-mission', origineDeLaPage: PAGE }
    );
    expect(verdict.refusees.map((r) => r.url)).toEqual(['https://cdn.test/lib.js']);
  });
});

describe('tiers après interaction — le contrat avec la règle d’AVANT', () => {
  it('un geste non déclaré fait LEVER : on ne juge pas un geste sans avoir écrit ses droits', () => {
    expect(() => autorisationsDe('geste-inconnu')).toThrow(/n’est pas déclaré/);
    expect(() =>
      jugerApresInteraction([], { interaction: 'geste-inconnu', origineDeLaPage: PAGE })
    ).toThrow(/geste-inconnu/);
    expect(NOMS_DES_INTERACTIONS).toEqual(['ouvrir-la-carte', 'chercher-une-mission']);
  });

  it('les deux règles ne divergent pas sur QUI est tiers : elles se partagent la définition', () => {
    const corpus = [
      requeteDeCarte(),
      { url: 'https://analytics.example/collect', sorte: 'Fetch', initiateur: { type: 'script' } },
      { url: `${PAGE}/assets/index-abc.js`, sorte: 'Script', initiateur: { type: 'parser' } },
      { url: 'http://127.0.0.1:8123/api/jobs', sorte: 'Fetch', initiateur: { type: 'script' } },
    ];
    const avant = divergencesDeTiers(corpus, { origineDeLaPage: PAGE });
    const apres = jugerApresInteraction(corpus, { interaction: 'ouvrir-la-carte', origineDeLaPage: PAGE });
    // Même liste de tierces, d'un côté comme de l'autre — seule la SORTE du
    // verdict change (un refus absolu d'un côté, un partage autorisé/refusé de
    // l'autre).
    expect(apres.autorisees.length + apres.refusees.length).toBe(avant.length);
    expect([...apres.autorisees, ...apres.refusees].map((r) => r.url).sort()).toEqual(
      avant.map((d) => d.url).sort()
    );
  });

  it('les limites de la sonde sont PUBLIÉES : ce qu’elle voit, ce qu’elle ne peut pas voir', () => {
    expect(CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR.peutVoir.length).toBeGreaterThanOrEqual(3);
    expect(CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR.nePeutPasVoir.length).toBeGreaterThanOrEqual(4);
    const limites = CE_QUE_CETTE_SONDE_NE_PEUT_PAS_VOIR.nePeutPasVoir.join(' ');
    // Les deux vraies limites, nommées : le tiers est REMPLACÉ (donc ce qu'il
    // demande ensuite n'est pas jugé), et la fenêtre d'écoute est bornée.
    expect(limites).toMatch(/remplace/);
    expect(limites).toMatch(/silence/);
    expect(limites).toMatch(/initiateur inconnu/);
  });
});
