import { test, expect } from '@playwright/test';
// Le harnais partagé : la mise en page doit s'être STABILISÉE, pas seulement
// avoir changé d'URL (voir `connexion` ci-dessous).
import { attendreLaStabilite } from './helpers/geometrie.js';

/**
 * Le centre de notifications : UN panneau pour tout le site, et une suppression
 * qui retire VRAIMENT la ligne.
 *
 * ── Ce que ces parcours couvrent, et que jsdom ne peut pas voir ─────────────
 * La barre de navigation existe en deux dispositions (desktop `hidden md:flex`
 * et mobile `md:hidden`) parce que la cloche doit exister dans les deux. Elle
 * montait donc DEUX panneaux, chacun avec son écouteur `mousedown` sur le
 * document : un appui DANS le panneau visible n'était « à l'intérieur » que pour
 * une seule des deux instances, l'autre appelait `closePanel()`, le panneau se
 * démontait pendant l'appui, et le `click` n'atteignait plus le bouton —
 * supprimer ne partait jamais, sans requête et sans message (symptôme : « la
 * notification montre toujours 1 et refuse de disparaître »).
 *
 * La séquence qui compte est celle du navigateur : appui PUIS relâchement.
 * `page.click()` l'envoie pour de vrai (`mousedown` → `mouseup` → `click`) sur
 * le bundle compilé, dans un vrai Chromium : c'est la seule exécution où la
 * disparition est observable — un test qui n'enverrait qu'un `click` isolé, ou
 * une doublure de service, passe sans rien mesurer.
 *
 * La seconde moitié du défaut est STRUCTURELLE — le nombre de panneaux — et se
 * mesure ici pour la même raison : jsdom ne calcule aucune mise en page, donc il
 * ne peut pas voir qu'une barre cesse d'être affichée quand la fenêtre franchit
 * le point de rupture. Le second parcours franchit ce point pour de vrai.
 *
 * Le troisième parcours le fait AU DOIGT, sur un écran de téléphone : c'est la
 * barre mobile qui doit gagner. Cinq propriétés n'existent que là — l'appui
 * tactile lui-même, la place du panneau dans 412 px, l'ancrage AU-DESSUS de la
 * barre du bas (l'unique barre qui porte une cloche sur un téléphone),
 * l'inversion au second appui, et un appui extérieur qui atteint sa cible.
 * Détail de ce qu'il couvre et de ce qui a été mesuré : voir son commentaire.
 *
 * La fixture est un VRAI serveur : `scripts/playtest-api-server.mjs` sert une
 * notification non lue au compte connecté et traite sa suppression, donc la
 * ligne ne disparaît que si la requête est bien partie.
 */

/**
 * Connexion par un compte de la fixture (scripts/playtest-api-server.mjs).
 *
 * Chaque compte a SON centre de notifications : la fixture crée une ligne non
 * lue à la connexion, indexée par identifiant de compte. Le parcours mobile
 * prend donc `client@example.com` — supprimer une ligne pour un compte ne dit
 * rien de l'autre, et l'ordre des tests cesse d'être une dépendance cachée.
 */
async function connexion(page, email = 'demo@example.com') {
  await page.goto('/login');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('password');
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/.*dashboard.*/, { timeout: 10000 });
  // L'URL a changé, la barre se réinstalle encore : un geste parti pendant cette
  // réinstallation est perdu (mesuré le 26/09/2026 — appui sur « Emplois » sans
  // navigation en WebKit, `NS_BINDING_ABORTED` sur un `goto` en Firefox). On
  // attend donc la STABILITÉ de la mise en page, harnais partagé.
  await attendreLaStabilite(page);
}

test.describe('Parcours E2E — le centre de notifications se vide', () => {
  test("un clic sur la croix d'une ligne la supprime, pastille comprise", async ({ page }) => {
    await connexion(page);

    // La cloche annonce la non-lue servie par la fixture.
    const cloche = page.locator('button[aria-label^="Notifications"]').first();
    await expect(cloche).toContainText('1', { timeout: 10000 });
    await cloche.click();

    const panneau = page.locator('[data-notification-panel]');
    await expect(panneau).toHaveCount(1);
    await expect(panneau).toBeVisible();
    await expect(panneau.getByText('Nouvelle proposition reçue')).toBeVisible();

    await panneau.getByRole('button', { name: 'Supprimer cette notification' }).click();

    // La ligne part, le panneau ouvre son état vide, la pastille tombe.
    await expect(panneau.getByText('Nouvelle proposition reçue')).toHaveCount(0);
    await expect(panneau.getByText('Aucune notification')).toBeVisible();
    await expect(page.locator('button[aria-label^="Notifications"] .bg-red-500')).toHaveCount(0);
  });
});

test.describe("Parcours E2E — un seul panneau, hébergé par la barre qui l'ouvre", () => {
  test("les deux barres partagent le même panneau, et il se ferme si sa barre disparaît", async ({ page }) => {
    await connexion(page);

    // Le profil « Desktop Chrome » est plus large que le point de rupture `md` :
    // les DEUX barres sont dans le DOM, seule celle du haut est affichée.
    const cloches = page.locator('button[aria-label^="Notifications"]');
    await expect(cloches).toHaveCount(2);

    await cloches.first().click();

    // Deux cloches, UN panneau : c'est tout l'objet de l'architecture.
    const panneaux = page.locator('[data-notification-panel]');
    await expect(panneaux).toHaveCount(1);

    // …et ce panneau est rendu DANS le conteneur de la cloche cliquée, ce qui
    // lui donne son ancrage (`absolute right-0 mt-2`) sans mesurer un pixel.
    const hebergement = await panneaux.evaluate((panneau) => {
      const toutes = [...document.querySelectorAll('button[aria-label^="Notifications"]')];
      const dedans = toutes.filter((cloche) => panneau.parentElement.contains(cloche));
      return {
        combien: dedans.length,
        affichees: dedans.filter((cloche) => cloche.getClientRects().length > 0).length,
      };
    });
    expect(hebergement).toEqual({ combien: 1, affichees: 1 });

    // Franchir le point de rupture (768 px) retire la barre desktop : le panneau
    // n'a plus de domicile affiché et se ferme, au lieu de rester `isOpen` dans
    // un conteneur `display:none` — invisible, et donnant l'impression que la
    // cloche redevenue visible ne fait rien (son premier appui ne ferait que
    // refermer un panneau que personne ne voit).
    await page.setViewportSize({ width: 500, height: 900 });
    await expect(panneaux).toHaveCount(0);

    // La cloche mobile ouvre le MÊME panneau unique, sous sa propre barre.
    await page.locator('button[aria-label^="Notifications"]:visible').click();
    await expect(panneaux).toHaveCount(1);
    await expect(panneaux).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();

    const hebergementMobile = await panneaux.evaluate((panneau) => {
      const toutes = [...document.querySelectorAll('button[aria-label^="Notifications"]')];
      const dedans = toutes.filter((cloche) => panneau.parentElement.contains(cloche));
      return {
        combien: dedans.length,
        affichees: dedans.filter((cloche) => cloche.getClientRects().length > 0).length,
      };
    });
    expect(hebergementMobile).toEqual({ combien: 1, affichees: 1 });

    // …et c'est bien la barre du BAS qui le porte : les deux barres existent dans
    // le même DOM, et une hébergement « affiché » ne dit pas laquelle des deux
    // est affichée. Le contrôle explicite évite qu'un retour de la cloche dans
    // le header (qui ferait aussi `{ combien: 1, affichees: 1 }`) fasse passer
    // ce parcours en mesurant l'autre barre.
    expect(
      await panneaux.evaluate((panneau) =>
        !!panneau.closest('[data-mobile-bottom-nav]')),
      'le panneau mobile doit être hébergé par la barre de navigation basse'
    ).toBe(true);
  });
});

/**
 * LE PARCOURS MOBILE — au DOIGT, et c'est la barre mobile qui gagne.
 *
 * Les deux barres sont dans le DOM sur tous les profils (l'une masquée par le
 * point de rupture `md`) : « laquelle gagne » n'est donc pas une évidence, c'est
 * une propriété à mesurer. Sur un téléphone, la cloche visible est celle de la
 * barre mobile, et le panneau — unique — doit être hébergé par ELLE : c'est ce
 * que `hebergement` exige (`combien: 1, affichees: 1` — une seule cloche le
 * porte, et c'est une cloche affichée).
 *
 * Cinq propriétés ne se mesurent QUE là, et c'est pourquoi ce parcours n'est pas
 * la répétition du précédent à une autre taille :
 *
 *   1. l'appui est TACTILE. Mesuré sur ce profil (sonde du 25/09/2026, journal
 *      des événements du document) : un `tap()` produit la séquence réelle
 *      `pointerdown → touchstart → touchend → mousedown → mouseup → click`.
 *      Ce n'est pas un détail : le panneau se ferme sur `mousedown` et supprime
 *      sur `click`, donc au doigt les DEUX mécanismes s'exécutent, dans cet
 *      ordre. Un appui sur la cloche qui serait vu comme « extérieur » par le
 *      `mousedown` refermerait le panneau avant que le `click` ne le rouvre ;
 *   2. le panneau tient ENTIÈREMENT dans l'écran (412 px) — il est ancré au bord
 *      droit de la barre du bas, sur son cinquième item ;
 *   3. son bord droit COÏNCIDE avec celui de la cloche mobile, et son BAS avec le
 *      HAUT de cette cloche : l'ancrage est du CSS (`absolute right-0` dans le
 *      conteneur transmis par la cloche, `bottom-full mb-2` parce que cette
 *      cloche déclare une ouverture VERS LE HAUT) — la propriété qui remplace
 *      toute mesure de coordonnées, et le sens est ici mesuré et non supposé :
 *      sous une barre collée au bas de l'écran, un panneau qui descendrait
 *      sortirait de la fenêtre (§ mutation rejouée le 25/09/2026 : ancrage
 *      laissé vers le bas, la boîte sort par le bas et l'assertion rougit) ;
 *   4. la croix de la ligne est ATTEIGNABLE SANS SURVOL et fait au moins 44 px :
 *      la classe `sm:opacity-0` ne l'apparaît qu'à la souris, et un doigt ne
 *      survole pas. L'appui sur cette croix ne doit pas non plus atteindre la
 *      ligne qui la contient — celle-ci ouvre la mission liée, et un doigt qui
 *      visait « supprimer » se retrouverait sur la fiche de la mission ;
 *   5. l'appui EXTÉRIEUR se termine là où il visait. C'est la classe de défaut
 *      du panneau lui-même : un appui perdu n'est pas un appui ignoré, c'est un
 *      appui VOLÉ. Ici la cible est un AUTRE item de la barre du bas — une
 *      commande de la même barre que la cloche, donc le pire voisin possible —
 *      et la preuve est une navigation : le panneau se ferme ET l'écran change.
 */
test.describe('Parcours E2E mobile — au doigt, la barre mobile gagne', () => {
  // Le profil de référence du dépôt pour un téléphone (le même que la sonde de
  // géométrie du LCP), avec un vrai écran tactile.
  test.use({ viewport: { width: 412, height: 823 }, hasTouch: true, isMobile: true });

  /**
   * LA SÉQUENCE D'ÉVÉNEMENTS D'UN APPUI, publiée moteur par moteur.
   *
   * ── Pourquoi ce cas existe, alors que les autres passent ───────────────────
   * Le panneau se ferme sur `mousedown` et AGIT sur `click` : tout ce fichier
   * repose donc sur l'ordre et sur la présence des événements de COMPATIBILITÉ
   * qu'un moteur émet après un appui tactile. Cette séquence est un fait de
   * MOTEUR, pas de l'application — et jusqu'ici elle n'était ni mesurée ni
   * publiée, seulement décrite en commentaire.
   *
   * Relevé du 26/09/2026, à 412×823 avec `hasTouch`, sur les trois moteurs
   * rejoués par cette suite (Chromium, Firefox, WebKit) : les trois émettent
   * EXACTEMENT `pointerdown → touchstart → pointerup → touchend → mousedown →
   * mouseup → click`. Le cas est donc un PIN, et sa valeur est là : le jour où
   * un moteur cesse d'émettre les événements de compatibilité — ou les émet
   * dans un autre ordre — le panneau se fermerait AVANT que le `click` n'arrive
   * (la panne historique, « l'appui ne supprime jamais »), et c'est ici que le
   * rouge nommerait le moteur ET la séquence, au lieu de laisser le lecteur la
   * déduire d'un timeout ailleurs.
   *
   * Le relevé est PUBLIÉ avant de conclure : un vert sans chiffre ne prouve rien.
   */
  test("la séquence d'événements d'un appui est celle que le panneau suppose", async ({ page }) => {
    await connexion(page, 'client@example.com');

    const clocheMobile = page.locator('button[aria-label^="Notifications"]:visible');
    await expect(clocheMobile).toContainText('1', { timeout: 10000 });

    // L'espion est posé APRÈS la connexion (la page ne navigue plus, un
    // écouteur posé avant serait perdu au remplacement du document) et il
    // écoute en phase de CAPTURE : ce qui est relevé est ce que le document
    // voit passer, dans l'ordre, avant que React n'y réagisse.
    await page.evaluate(() => {
      window.__sequenceAppui = [];
      for (const type of ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click']) {
        document.addEventListener(type, () => window.__sequenceAppui.push(type), true);
      }
    });

    await clocheMobile.tap();
    // Le panneau est ouvert : le `click` de l'appui a donc été traité, la
    // séquence est complète quand on la lit.
    await expect(page.locator('[data-notification-panel]')).toHaveCount(1);
    const sequence = await page.evaluate(() => window.__sequenceAppui.slice());

    console.log(
      `ℹ️  Séquence d'appui (${test.info().project.name}, 412×823 tactile) : ${sequence.join(' → ') || '(aucun événement)'}`
    );

    expect(
      sequence,
      `séquence d'appui du moteur ${test.info().project.name} : ${sequence.join(' → ') || '(aucun événement)'} — ` +
        "le panneau se ferme sur `mousedown` et supprime sur `click` : sans les événements de " +
        'compatibilité, dans cet ordre, l\'appui est perdu (panne historique). Relever la séquence ' +
        'du moteur, puis décider : la corriger si le moteur est en tort, adapter le panneau sinon.'
    ).toEqual(['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click']);
  });

  test("la cloche mobile ouvre le panneau unique, et la croix se laisse toucher", async ({ page }) => {
    await connexion(page, 'client@example.com');

    // Deux cloches existent, une seule est affichée : celle de la barre du BAS
    // (le header mobile n'en porte plus — c'est la barre du pouce qui la porte).
    await expect(page.locator('button[aria-label^="Notifications"]')).toHaveCount(2);
    const clocheMobile = page.locator('button[aria-label^="Notifications"]:visible');
    await expect(clocheMobile).toHaveCount(1);
    await expect(clocheMobile).toContainText('1', { timeout: 10000 });

    await clocheMobile.tap();

    const panneaux = page.locator('[data-notification-panel]');
    await expect(panneaux).toHaveCount(1);
    await expect(panneaux).toBeVisible();

    // Le panneau est hébergé par le conteneur de la cloche VISIBLE — donc par la
    // barre mobile, et non par celle de la barre desktop.
    const hebergement = await panneaux.evaluate((panneau) => {
      const toutes = [...document.querySelectorAll('button[aria-label^="Notifications"]')];
      const dedans = toutes.filter((cloche) => panneau.parentElement.contains(cloche));
      return {
        combien: dedans.length,
        affichees: dedans.filter((cloche) => cloche.getClientRects().length > 0).length,
      };
    });
    expect(hebergement).toEqual({ combien: 1, affichees: 1 });

    // L'ancrage tient dans un écran de téléphone.
    // Le panneau est ancré au bord droit de la barre du bas, sur le cinquième
    // item (la cloche). Élargi à 380 px (mutation rejouée le 25/09/2026), il
    // sort par la GAUCHE de l'écran (x = −32) et l'assertion rougit — c'est la
    // propriété mobile que ce contrôle tient, et elle ne se voit qu'à cette
    // taille.
    const boite = await panneaux.boundingBox();
    const boiteCloche = await clocheMobile.boundingBox();
    expect(boite.x).toBeGreaterThanOrEqual(0);
    expect(boite.x + boite.width).toBeLessThanOrEqual(412);

    // …et il s'ouvre AU-DESSUS de la barre du BAS, pas seulement « quelque
    // part » : son bord droit est celui de la cloche qui l'a ouvert (l'ancre est
    // `relative` autour du bouton, le panneau y est `absolute right-0`) et son
    // BAS touche le HAUT de cette cloche. Aucune coordonnée n'est écrite en
    // dur : c'est la relation entre les deux boîtes qui est vérifiée, donc
    // l'assertion survit à un changement de padding ou de largeur de barre.
    expect(Math.abs(boite.x + boite.width - (boiteCloche.x + boiteCloche.width))).toBeLessThanOrEqual(1);
    expect(boite.y + boite.height).toBeLessThanOrEqual(boiteCloche.y);
    // Le panneau ne doit pas non plus sortir par le HAUT : c'est la seule
    // direction qui lui reste, et elle est bornée par `max-h-[520px]` / la
    // hauteur de la fenêtre.
    expect(boite.y).toBeGreaterThanOrEqual(0);

    // La croix, visible sans survol et assez grande pour un doigt.
    const croix = panneaux.getByRole('button', { name: 'Supprimer cette notification' });
    await expect(croix).toBeVisible();
    const cible = await croix.boundingBox();
    expect(Math.min(cible.width, cible.height)).toBeGreaterThanOrEqual(44);

    await croix.tap();

    // La ligne part, l'état vide s'affiche, la pastille tombe — et l'appui n'a
    // pas été volé par la ligne qui mène à la mission liée.
    await expect(panneaux.getByText('Nouvelle proposition reçue')).toHaveCount(0);
    await expect(panneaux.getByText('Aucune notification')).toBeVisible();
    await expect(page.locator('button[aria-label^="Notifications"] .bg-red-500')).toHaveCount(0);
    await expect(page).toHaveURL(/\/dashboard/);

    // Le panneau est resté OUVERT pendant tout ce qui précède (aucune de ces
    // assertions ne l'a fermé) : c'est l'état où la suite se mesure.
    await expect(panneaux).toHaveCount(1);

    // Second appui sur la cloche : il referme. C'est l'inversion qui prouve que
    // le `mousedown` de compatibilité n'est pas pris pour un appui extérieur —
    // s'il l'était, le panneau se fermerait au `mousedown` et le `click` qui
    // suit appellerait `togglePanel` sur un panneau déjà fermé, donc le
    // ROUVRIRAIT : le panneau semblerait insensible au doigt.
    await clocheMobile.tap();
    await expect(panneaux).toHaveCount(0);

    // Troisième appui : il rouvre. Le panneau est donc bien piloté au doigt, et
    // pas seulement ouvrable une fois.
    await clocheMobile.tap();
    await expect(panneaux).toHaveCount(1);

    // L'appui extérieur, au doigt : un AUTRE item de la MÊME barre — le pire
    // voisin possible, puisqu'il est à quelques pixels de la cloche qui a ouvert
    // le panneau, sous l'ancre et non à l'autre bout de l'écran.
    // Deux choses doivent être vraies dans le même geste : le panneau se ferme
    // (c'est le `mousedown` du document) et la commande AGIT (c'est le `click`
    // qui suit, et il navigue). Si une surface plein écran captait l'appui — le
    // défaut mesuré ailleurs sur `LanguageSelector`, où Playwright réessayait le
    // clic 55 fois de suite — le panneau se fermerait sans que rien d'autre ne se
    // passe, et c'est cette assertion qui le dirait.
    await page.locator('[data-mobile-bottom-nav] a[href="/jobs"]').first().tap();
    await expect(panneaux).toHaveCount(0);
    await expect(page).toHaveURL(/\/jobs$/);
  });
});
