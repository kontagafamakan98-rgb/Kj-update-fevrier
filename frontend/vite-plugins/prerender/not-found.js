// La page 404 statique : servie par Vercel sans scripts, noindex.

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

