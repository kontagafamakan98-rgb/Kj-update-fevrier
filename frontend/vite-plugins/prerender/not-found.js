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
    '<style>',
    'body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f9fafb;color:#111827}',
    'main{max-width:640px;margin:0 auto;padding:4rem 1.5rem;text-align:center}',
    'h1{font-size:1.875rem;margin:0 0 1rem}',
    'p{color:#4b5563;line-height:1.6}',
    'nav{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;margin-top:2rem}',
    'a{color:#ea580c;font-weight:600}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    `<h1>${T('notFoundTitle')}</h1>`,
    `<p>${T('notFoundText')}</p>`,
    '<nav>',
    `<a href="/">${T('home')}</a>`,
    `<a href="/jobs">${T('notFoundJobsLink')}</a>`,
    `<a href="/how-it-works">${T('howItWorksTitle')}</a>`,
    `<a href="mailto:${contact.email}">${T('contactTitle')}</a>`,
    '</nav>',
    `</main></body></html>`,
  ].join('')
}

