// La page 404 statique : servie par Vercel sans scripts, noindex.

/**
 * Le NOM de l'artefact, lu des DEUX côtés : le build l'ÉCRIT, et le garde
 * d'après-build (`scripts/check-prerender-shells.js`) le RELIT pour vérifier
 * l'équilibre de ses balises. Le nom vit ici, près de ce qui le produit, pour
 * qu'un artefact renommé ne puisse pas sortir du contrôle en silence — un
 * fichier que le garde ne lit pas est un fichier dont l'équilibre n'est vérifié
 * par personne, et c'est exactement l'angle que cette page fermait.
 */
export const NOM_DE_LA_PAGE_404 = '404.html';

export function buildNotFoundPage({ T, contact }) {
  // ── Page 404 ────────────────────────────────────────────────
  // Servie par Vercel (statut 404) pour une URL qui ne correspond à
  // aucun fichier ni rewrite. Sans scripts : elle doit fonctionner
  // même si le bundle échoue à se charger. noindex : une page 404
  // indexée est un « soft 404 ».
  return [
    '<!DOCTYPE html>',
    '<html lang="fr">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<meta name="robots" content="noindex, follow" />',
    `<title>${T('notFoundMetaTitle')}</title>`,
    // La DESCRIPTION, comme sur les douze coquilles de route. C'est le seul
    // document pré-rendu du build qui n'en portait aucune, et c'est un document
    // qu'un crawler LIT (il reçoit le statut 404, mais il lit ce qu'on lui
    // sert). Elle réutilise `notFoundText` — le paragraphe de la page, déjà
    // traduit dans les cinq langues — plutôt que d'ajouter une sixième clé : la
    // page est en `noindex`, donc cette description ne devient jamais un extrait
    // de résultat qui devrait différer du texte visible, et une clé unique ne
    // peut pas diverger d'elle-même.
    `<meta name="description" content="${T('notFoundText')}" />`,
    // La typographie du site, comme sur les quarante-cinq pages écrites par le
    // backend : Inter au corps, Cormorant Garamond au titre. Sans elle, la 404
    // — la page qu'un visiteur voit après un lien mort — était la SEULE du site
    // à peindre `system-ui`.
    //
    // Les deux préchargements sont ceux d'`index.html`, `crossorigin` compris
    // (obligatoire même en même-origine : sans lui le préchargement est ignoré
    // en silence). Les `@font-face` ne portent PAS d'`unicode-range`, à la
    // différence d'`index.css` : cette page est unique et son texte est
    // générique, donc le sous-ensemble `latin-ext` ne servirait à rien — et le
    // budget de CSS inlinée de `404.html` est de 2 048 o
    // (`scripts/check-css-inline-budget.js`), qu'un second couple de faces
    // franchirait.
    '<link rel="preload" as="font" type="font/woff2" href="/fonts/inter-variable-latin.woff2" crossorigin />',
    '<link rel="preload" as="font" type="font/woff2" href="/fonts/cormorant-garamond-variable-latin.woff2" crossorigin />',
    '<style>',
    "@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/inter-variable-latin.woff2') format('woff2')}",
    "@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:500 700;font-display:swap;src:url('/fonts/cormorant-garamond-variable-latin.woff2') format('woff2')}",
    // ── LA PALETTE DU SITE, PAS CELLE DE L'HÔTE (29/10/2026) ────────────────
    // La page peignait `#f9fafb` / `#111827` / `#4b5563` — le gris FROID d'un
    // gabarit générique, celui qui jure avec l'encre chaude du reste du site —
    // et ses liens `#ea580c`, une teinte mesurée à 3,39:1 sur une surface
    // claire (sous le seuil de 4,5:1). Les valeurs ci-dessous sont CELLES DES
    // JETONS de `src/index.css` (`--kojo-sable` #f7f3ec, `--kojo-encre` #1c1917,
    // `--kojo-encre-douce` #5c554d, `--kojo-papier` #fffdf9, `--kojo-filet`
    // #e6e1d7, `--kojo-orange-fonce` #c2410c) : cette page n'a pas de feuille
    // externe, donc elle les écrit en littéral — et un test compare ces
    // littéraux aux jetons du socle pour qu'une retouche d'un seul côté rougisse.
    //
    // Les COMPOSANTS sont ceux du site : la carte éditoriale (verre de papier
    // chaud, filet de crème, reflet en tête : mêmes valeurs que
    // `.carte-editoriale`) et les deux boutons (`.bouton-encre`, `.bouton-clair`).
    'body{margin:0;font-family:\'Inter\',-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f7f3ec;color:#1c1917}',
    'main{max-width:640px;margin:0 auto;padding:4rem 1.5rem}',
    '.carte{background:rgba(252,249,242,.94);border:1px solid rgba(240,220,195,.9);border-radius:8px;padding:2rem 1.5rem;text-align:center;box-shadow:inset 0 1px 0 rgba(255,255,255,.65)}',
    'p{color:#5c554d;line-height:1.6}',
    '.marque{color:#c2410c;font-size:.875rem;font-weight:700;letter-spacing:.08em;margin:0;text-transform:uppercase}',
    "h1{font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;font-weight:700;font-size:2.25rem;margin:.5rem 0 1rem}",
    '.actions{display:flex;flex-wrap:wrap;gap:.75rem;justify-content:center;margin-top:1.5rem}',
    '.bouton{display:inline-flex;align-items:center;justify-content:center;min-height:3.25rem;padding:0 1.5rem;border:1px solid transparent;border-radius:3px;font-weight:700;text-decoration:none}',
    '.encre{background:#1c1917;color:#fff}',
    '.clair{background:#fffdf9;border-color:#e6e1d7;color:#1c1917}',
    '.liens{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;margin-top:1rem}',
    '.liens a{color:#c2410c;font-weight:600}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<div class="carte">',
    '<p class="marque">404</p>',
    `<h1>${T('notFoundTitle')}</h1>`,
    `<p>${T('notFoundText')}</p>`,
    '<div class="actions">',
    `<a class="bouton encre" href="/">${T('home')}</a>`,
    `<a class="bouton clair" href="/jobs">${T('notFoundJobsLink')}</a>`,
    '</div>',
    '<div class="liens">',
    `<a href="/how-it-works">${T('howItWorksTitle')}</a>`,
    `<a href="mailto:${contact.email}">${T('contactTitle')}</a>`,
    '</div>',
    '</div>',
    `</main></body></html>`,
  ].join('')
}
