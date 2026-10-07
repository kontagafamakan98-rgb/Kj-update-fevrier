import { test, expect } from '@playwright/test';
// La liste des routes, les deux tailles et le protocole à deux peintures (le
// bundle d'entrée bloqué pour mesurer la coquille SEULE) sont ceux du harnais
// partagé — jamais une copie. La table unique est `src/config/page-meta.js`.
import {
  ROUTES,
  TAILLES,
  ouvrirLaPage,
  MARQUEUR_DE_MONTAGE,
  attendreLaStabilite,
} from './helpers/geometrie.js';

/**
 * AUCUNE COMMANDE PUBLIÉE N'EST RECOUVERTE : l'appui qui la vise l'atteint.
 *
 * ── Le défaut, mesuré le 07/10/2026 sur l'accueil ───────────────────────────
 * Les deux appels du héros (« Commencer maintenant », « Voir les emplois ») ne
 * faisaient rien. La cause n'était ni la route, ni le gestionnaire, ni le lien :
 * le héros peint son fond avec une seconde couche, `<div class="absolute
 * inset-0 bg-black bg-opacity-5">`. Étant POSITIONNÉE, elle se peint après le
 * contenu statique de la section, donc AU-DESSUS — et elle devient la cible de
 * tout appui tombant sur sa surface. `document.elementFromPoint` au centre des
 * deux boutons rendait ce `<div>` : l'appui était avalé par une teinte
 * décorative à 5 %, et Playwright le voyait comme « intercepts pointer events ».
 *
 * ── Pourquoi une sonde GÉNÉRALE, et pas un cas sur les deux boutons ─────────
 * Parce que le défaut n'a rien de propre au héros : c'est la classe entière
 * « une couche de peinture posée au-dessus d'une commande ». Elle a déjà frappé
 * ce dépôt par un autre chemin (`fixed inset-0` du menu de langue : Playwright
 * retentait 55 fois un clic sur « Emplois », cf. `appuis-exterieurs.spec.js`).
 * Une sonde qui n'épingle que les deux boutons d'aujourd'hui laisserait la
 * même faute revenir demain sur une autre page. Ici, on mesure le FAIT sur
 * TOUTES les routes pré-rendues, aux deux tailles, et dans les DEUX canaux :
 * la coquille (sans JavaScript) et la navigation réelle. La coquille compte,
 * et pas seulement par symétrie : elle publie les deux appels du héros en
 * `<a href>` réels AVANT l'hydratation, donc le même voile y rendait deux
 * boutons morts — pour un crawler, et pour un visiteur dont le JavaScript
 * n'est pas encore arrivé.
 *
 * ── Ce que la sonde ACCEPTE, et pourquoi (la frontière, écrite) ─────────────
 * jsdom ne peut rien voir de tout ça : il ne calcule aucune mise en page, et
 * `fireEvent.click(element)` envoie l'appui DIRECTEMENT à l'élément. Seul un
 * navigateur connaît l'ordre de peinture. On y lit donc, pour chaque commande
 * du PREMIER ÉCRAN, l'élément que le navigateur renverrait pour un appui en son
 * centre, et l'appui est jugé ATTEINT quand l'élément rendu est la commande
 * elle-même, un de ses descendants, ou un de ses ancêtres. En revanche, deux
 * couvreurs ne sont PAS des défauts, et c'est une décision :
 *   • une couche qui PORTE du texte (la barre de navigation collante, la barre
 *     du bas, un titre qui passe devant) — l'appui y trouve du contenu, ce
 *     n'est pas une interception silencieuse ;
 *   • une couche qui se laisse APPUYER (le fond d'un tiroir, qui EST un
 *     bouton, ou un descendant d'une commande) — l'appui y trouve une cible.
 * Ce que la sonde refuse est donc exactement la décoration silencieuse : une
 * boîte sans texte, sans rôle, qui n'offre rien et qui prend l'appui.
 *
 * ── Ce que cette sonde ne couvre PAS ────────────────────────────────────────
 * Les routes non pré-rendues (`/dashboard`, `/profile`, `/messages`), dont le
 * premier écran est celui du JavaScript — il faudrait une session, et le défaut
 * mesuré vivait au-dessus d'une coquille. Et les commandes SOUS la ligne de
 * flottaison : sans défilement, une commande plus bas n'est pas « recouverte »,
 * elle est ailleurs.
 */

/**
 * Le relevé : pour chaque commande du premier écran, son nom, sa destination et
 * ce que le navigateur rendrait pour un appui en son centre.
 */
const RELEVE_ATTEIGNABILITE = () => {
  const INTERACTIF = 'a[href], button, input, select, textarea, [role="button"]';
  const COMMANDES = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"]';

  const nom = (element) => {
    const brut =
      element.getAttribute('aria-label') ||
      element.textContent ||
      element.getAttribute('href') ||
      element.tagName;
    return brut.trim().replace(/\s+/g, ' ').slice(0, 48);
  };

  /** Une commande PEINTE : une boîte, et visible. */
  const peinte = (element) => {
    const r = element.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };

  const releve = [];
  for (const commande of document.querySelectorAll(COMMANDES)) {
    if (!peinte(commande)) continue;
    const r = commande.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // Le PREMIER ÉCRAN seulement, page non défilée.
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;

    const identite = {
      nom: nom(commande),
      balise: commande.tagName,
      href: commande.getAttribute('href'),
      x: Math.round(x),
      y: Math.round(y),
    };
    const dessus = document.elementFromPoint(x, y);
    if (!dessus) {
      releve.push({ ...identite, atteignable: false, couvreur: 'rien (aucun élément rendu à ce point)' });
      continue;
    }
    if (dessus === commande || commande.contains(dessus) || dessus.contains(commande)) {
      releve.push({ ...identite, atteignable: true, couvreur: null });
      continue;
    }
    // Les deux couvreurs ACCEPTÉS (voir l'en-tête) : du contenu, ou une cible.
    const appuyable = Boolean(dessus.closest(INTERACTIF));
    const avecTexte = (dessus.textContent || '').trim().length > 0;
    releve.push({
      ...identite,
      atteignable: appuyable || avecTexte,
      couvreur: appuyable || avecTexte ? null : `${dessus.tagName}.${dessus.className}`,
    });
  }
  return releve;
};

/**
 * Les couples route@taille dont la COQUILLE ne publie AUCUNE commande dans le
 * premier écran.
 *
 * La coquille n'a de la barre de navigation qu'un PLACEHOLDER (65 px réservés,
 * aucun lien) — c'est le chrome partagé — et ces quatre pages sont du TEXTE :
 * à la taille notée, leur premier écran n'offre rien à appuyer. La propriété
 * « aucune commande n'est recouverte » y est vraie PAR VACUITÉ, et on le
 * DÉCLARE ici plutôt que de laisser un vert muet : le relevé a bel et bien
 * tourné, il a trouvé zéro commande.
 *
 * La taille fait partie de la clé parce que la vacuité en dépend : à 412 × 823
 * la fenêtre est plus courte qu'à 1350 × 940, donc un lien que la coquille
 * publie plus bas tombe hors du premier écran — MESURÉ le 07/10/2026, /about
 * est vide en mobile et ne l'est plus en desktop.
 *
 * L'exemption se REFUSE dès qu'elle devient fausse : un couple de cette table
 * dont la coquille publierait une commande — le jour où sa coquille gagne un
 * lien ou un champ — fait ROUGIR le cas, et il faut alors l'en sortir, donc la
 * mesurer comme les autres. Une exemption qu'on n'ose plus retirer est une
 * exemption qui ment.
 */
const COQUILLE_SANS_COMMANDE = [
  '/about@mobile',
  '/how-it-works@mobile',
  '/how-it-works@desktop',
  '/privacy@mobile',
  '/privacy@desktop',
  '/terms@mobile',
  '/terms@desktop',
];

/** Le message d'un rouge : quelles commandes, et sous quelle couche. */
const recouvertes = (releve) =>
  releve
    .filter(({ atteignable }) => !atteignable)
    .map(({ nom, balise, href, x, y, couvreur }) => `${balise} « ${nom} »${href ? ` → ${href}` : ''} à (${x}, ${y}) — couvert par « ${couvreur} »`);

for (const route of ROUTES) {
  for (const { nom: taille, viewport } of TAILLES) {
    for (const peinture of ['coquille', 'reelle']) {
      test(`${route} — ${taille} (${peinture}) : chaque commande du premier écran reçoit son appui`, async ({
        browser,
      }) => {
        const page = await ouvrirLaPage(browser, peinture, viewport);
        await page.goto(route, { waitUntil: 'load' });

        if (peinture === 'reelle') {
          // La navbar peuplée : la coquille n'en publie qu'un placeholder vide,
          // donc ce sélecteur ne peut exister QUE si React a monté.
          await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });
        }
        await attendreLaStabilite(page);

        const releve = await page.evaluate(RELEVE_ATTEIGNABILITE);
        await page.close();

        if (route === '/') {
          // L'acceptation du défaut d'origine, NOMMÉE et INCONDITIONNELLE : les
          // deux appels du héros doivent être présents ET atteignables, dans les
          // deux canaux. Elle passe AVANT le plancher pour qu'aucune vacuité ne
          // puisse masquer l'accueil.
          const heros = releve.filter(({ nom }) =>
            ['Commencer maintenant', 'Voir les emplois'].includes(nom),
          );
          expect(heros.map(({ href }) => href).sort()).toEqual(['/jobs', '/register']);
          expect(recouvertes(heros)).toEqual([]);
        }

        const cle = `${route}@${taille}`;
        if (peinture === 'reelle') {
          // Côté React, la barre est PLEINE de liens sur les douze routes : un
          // relevé vide dit que la mesure est cassée, jamais que la page est
          // pauvre.
          expect(releve.length, 'aucune commande mesurée côté React : le relevé a-t-il lu son sujet ?').toBeGreaterThan(0);
        } else if (releve.length === 0) {
          expect(
            COQUILLE_SANS_COMMANDE,
            `la coquille de ${cle} ne publie aucune commande : cette vacuité doit être déclarée`,
          ).toContain(cle);
        } else {
          // Une exemption devenue fausse rougit : ce jour-là, la coquille a
          // gagné une commande dans son premier écran et doit être mesurée
          // comme les autres.
          expect(
            COQUILLE_SANS_COMMANDE,
            `${cle} publie ${releve.length} commande(s) : elle n'a plus rien à faire dans la table des coquilles vides`,
          ).not.toContain(cle);
        }
        expect(recouvertes(releve)).toEqual([]);
      });
    }
  }
}

/**
 * L'ACCEPTATION, MESURÉE PAR L'APPUI RÉEL — la commande du propriétaire du site :
 * « les touches commencer maintenant et voir les emplois ne fonctionnent pas ».
 *
 * La sonde ci-dessus dit que le centre des deux boutons rend BIEN le bouton ;
 * celle-ci appuie dessus pour de vrai, et exige les DEUX effets du même geste :
 * la page change, ET le raccord de vue est demandé (c'est la part « liquide »).
 * C'est exactement l'interface du visiteur — un `<a href>` réel, un appui, une
 * navigation — et non un raccourci de mesure : la sonde de recouvrement pourrait
 * être verte sur un lien dont le gestionnaire est cassé, et l'inverse est vrai
 * aussi.
 *
 * Le compteur de `startViewTransition` est posé AVANT tout script de la page
 * (`addInitScript`) : compter après coup ne pourrait pas voir l'appel du premier
 * appui. Dans l'armature « coquille », le bundle d'entrée est bloqué, donc React
 * n'existe pas : ce qui est mesuré là est le `<a href>` du HTML pré-rendu, qui
 * doit naviguer TOUT SEUL — c'est la promesse d'une coquille, et c'est ce que
 * les deux boutons morts trahissaient.
 */
const APPELS_DU_HEROS = [
  { libelle: 'Commencer maintenant', route: /\/register$/ },
  { libelle: 'Voir les emplois', route: /\/jobs$/ },
];

for (const { nom: taille, viewport } of TAILLES) {
  for (const peinture of ['coquille', 'reelle']) {
    for (const { libelle, route } of APPELS_DU_HEROS) {
      test(`accueil — ${taille} (${peinture}) : un appui sur « ${libelle} » change de page`, async ({
        browser,
      }) => {
        const page = await ouvrirLaPage(browser, peinture, viewport);
        await page.addInitScript(() => {
          window.__transitionsVue = 0;
          const vrai = window.document.startViewTransition;
          if (typeof vrai !== 'function') return;
          document.startViewTransition = (rappel) => {
            window.__transitionsVue += 1;
            return vrai.call(document, rappel);
          };
        });
        await page.goto('/', { waitUntil: 'load' });
        if (peinture === 'reelle') await page.waitForSelector(MARQUEUR_DE_MONTAGE, { timeout: 15000 });

        const lien = page.getByRole('link', { name: libelle }).first();
        await expect(lien, 'l’appel du héros doit être publié').toBeVisible();
        await lien.click();

        await expect(page).toHaveURL(route, { timeout: 10000 });
        if (peinture === 'reelle') {
          // Le raccord est demandé UNE fois : ni zéro (l'appui aurait été avalé,
          // ou la navigation serait un rechargement), ni deux (double appel).
          expect(await page.evaluate(() => window.__transitionsVue)).toBe(1);
        }
        await page.close();
      });
    }
  }
}
