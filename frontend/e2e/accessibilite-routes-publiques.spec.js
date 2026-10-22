/**
 * SCAN AXE DES ROUTES PUBLIQUES — et la PREUVE que le scan sait rougir.
 *
 * ── Pourquoi ce fichier existe ───────────────────────────────────────────────
 * Le dépôt savait mesurer des pixels (LCP, CLS, géométrie), des classes, des
 * textes — et pas une seule fois si une page était ATTEIGNABLE au clavier ou
 * lisible par un lecteur d'écran. L'audit du 22/10/2026 le disait sans détour :
 * « accessibilité non outillée (pas d'axe en CI, pas de lien d'évitement) ». Un
 * défaut d'accessibilité ne se voit pas à l'œil de celui qui n'en a pas besoin,
 * donc il ne se corrige jamais par hasard : il faut une mesure.
 *
 * ── Ce qui est jugé, et avec quel outil ─────────────────────────────────────
 * Axe sur les règles WCAG 2.1 A/AA, dans un NAVIGATEUR RÉEL (Playwright) et
 * non en jsdom : le contraste des couleurs ne se calcule pas sans mise en
 * page, et c'est justement un des échecs les plus fréquents sur un site
 * orange-sur-papier.
 *
 * Sont REFUSÉS : les constats `serious` et `critical`. Les `minor`/`moderate`
 * sont COMPTÉS et PUBLIÉS (console), jamais tus : un scan qui ne dit que « zéro
 * grave » laisse croire que tout va bien, alors qu'il a vu des choses.
 *
 * ── La preuve que ÇA ROUGIT ─────────────────────────────────────────────────
 * Un garde dont on n'a jamais vu l'échec peut être aveugle sans que personne ne
 * le sache (le motif F17 du registre). Chaque spec de ce fichier rejoue donc
 * l'échec : on INJECTE le défaut exact (image sans alternative, bouton sans
 * nom) et on exige que le MÊME analyseur le trouve. Le cas sain, lui, passe :
 * sans ça, une injection qui casse tout prouverait seulement que la page est
 * cassée, pas que le scan est vivant.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Les routes publiques : accessibles sans compte, donc jugées en visiteur. */
const ROUTES_PUBLIQUES = [
  { chemin: '/', nom: 'accueil' },
  { chemin: '/jobs', nom: 'liste des missions' },
  { chemin: '/how-it-works', nom: 'comment ça marche' },
  { chemin: '/about', nom: 'à propos' },
  { chemin: '/contact', nom: 'contact' },
  { chemin: '/privacy', nom: 'confidentialité' },
  { chemin: '/terms', nom: 'conditions' },
  { chemin: '/login', nom: 'connexion' },
  { chemin: '/register', nom: 'inscription' },
  { chemin: '/forgot-password', nom: 'mot de passe oublié' },
];

const IMPACTS_REFUSES = new Set(['serious', 'critical']);

/**
 * Passe axe et rend une forme COMPARABLE (id, impact, cibles) — la même pour
 * le cas réel et pour la mutation. Un analyseur qui ne rendrait pas la même
 * forme aux deux ne prouverait rien.
 */
const analyser = async (page) => {
  const resultat = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return resultat.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    cibles: violation.nodes.flatMap((noeud) => noeud.target),
    // Le DÉTAIL (ratio attendu/obtenu, nom accessible attendu) est ce qui rend
    // un rouge réparable : « color-contrast » seul ne dit pas quelle couleur
    // changer, et un développeur qui doit deviner finit par désactiver la règle.
    details: violation.nodes.map((noeud) =>
      (noeud.failureSummary || '')
        .split('\n')
        .map((ligne) => ligne.trim())
        .filter((ligne) => ligne && !/^Fix any of the following/.test(ligne))
        .join(' / ')
    ),
  }));
};

const refuses = (violations) => violations.filter((v) => IMPACTS_REFUSES.has(v.impact));

/** Attend que la page ait peint son contenu réel (les routes sont lazy-loadées). */
const ouvrir = async (page, chemin) => {
  await page.goto(chemin, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#root main')).toBeVisible();
};

test.describe('accessibilité — scan axe des routes publiques', () => {
  for (const route of ROUTES_PUBLIQUES) {
    test(`aucun constat grave sur « ${route.nom} » (${route.chemin})`, async ({ page }) => {
      await ouvrir(page, route.chemin);

      const violations = await analyser(page);
      const graves = refuses(violations);
      const declarees = violations.filter((v) => !IMPACTS_REFUSES.has(v.impact));

      if (declarees.length) {
        // PUBLIÉ, jamais tu : un scan qui ne parle que de ses refus laisse
        // croire que le reste est parfait.
        console.log(
          `ℹ️  ${route.chemin} : ${declarees.length} constat(s) mineur(s)/modéré(s) non bloquant(s) — ` +
            declarees.map((v) => `${v.id}(${v.impact})`).join(', ')
        );
      }

      expect(
        graves,
        `${route.chemin} : ${graves.length} constat(s) sérieux/critique(s)\n` +
          graves
            .map(
              (v) =>
                `  • ${v.id} [${v.impact}] → ${v.cibles.join(', ')}\n` +
                v.details.map((detail) => `      ${detail}`).join('\n')
            )
            .join('\n')
      ).toEqual([]);
    });
  }
});

test.describe('accessibilité — la preuve que le scan MORD', () => {
  test('une image sans alternative est REFUSÉE par le même analyseur', async ({ page }) => {
    await ouvrir(page, '/');

    // Le cas sain d'abord : le scan ne refuse rien, donc l'injection sera la
    // seule cause du rouge qui suit.
    expect(refuses(await analyser(page))).toEqual([]);

    // 1×1 PNG transparent : une image réelle, sans `alt` — le défaut exact que
    // WCAG 1.1.1 interdit.
    await page.evaluate(() => {
      const image = document.createElement('img');
      image.src =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
      document.querySelector('main').appendChild(image);
    });

    const apres = refuses(await analyser(page));

    expect(apres.map((v) => v.id), 'le scan NE mord PAS sur une image sans alt').toContain('image-alt');
  });

  test('un bouton sans nom accessible est REFUSÉ par le même analyseur', async ({ page }) => {
    await ouvrir(page, '/');

    await page.evaluate(() => {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      // Aucun texte, aucun aria-label, aucune image nommée : rien à annoncer.
      bouton.innerHTML = '<span class="h-4 w-4"></span>';
      document.querySelector('main').appendChild(bouton);
    });

    const apres = refuses(await analyser(page));

    expect(apres.map((v) => v.id), 'le scan NE mord PAS sur un bouton sans nom').toContain('button-name');
  });
});
