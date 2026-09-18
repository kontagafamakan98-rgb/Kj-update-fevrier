/**
 * Ce que l'application annonce pour une FICHE MISSION (/jobs/:id).
 *
 * Une fiche mission n'est pas une route comme les autres : son titre, sa
 * description et sa carte dépendent d'une DONNÉE, chargée après le montage. Elle
 * ne peut donc pas les lire dans une table (src/config/page-meta.js) comme les
 * routes statiques — sa page les déclare, et c'est ici qu'ils se décident.
 *
 * POURQUOI CETTE FONCTION EXISTE : elle rend le contrat app ↔ pré-rendu
 * vérifiable HORS LIGNE. La même mission est pré-rendue par le backend
 * (backend/kojo_job_og.py — le HTML que lit un crawler sans JavaScript, celui
 * qui porte le titre et la carte partagés) et annoncée par l'application ;
 * scripts/check-job-og-contract.js confronte les deux sur une mission de
 * référence, sans serveur et sans base de données. Avant, ce contrat n'était
 * vérifié qu'en HTTP, contre une mission réellement créée en base.
 *
 * Le formatage (« — Kojo », coupe à 150 caractères suivie de « … ») est donc écrit
 * ICI et dans kojo_job_og.py : deux langages, deux déploiements. C'est exactement
 * cette paire que le garde compare, donc aucune des deux copies ne peut bouger
 * seule.
 *
 * @param {{title?: string, description?: string, id?: string}} [job] Mission
 *   chargée — ou, tant qu'elle ne l'est pas, le strict nécessaire : `{ id }`,
 *   parce que la carte ne dépend pas du chargement (l'identifiant de la route
 *   suffit). Les autres champs valent alors '' : une fiche sans titre n'annonce
 *   pas de titre.
 * @returns {{title: string, description: string, card: string, canonicalPath: string}}
 *   Titre et description prêts à publier (chaîne vide = rien à annoncer,
 *   l'appelant garde alors son texte de repli), le CHEMIN de la carte (l'URL
 *   absolue est ajoutée par absoluteUrl — les crawlers l'exigent) et le CHEMIN
 *   canonique de la fiche.
 */
export const jobSeo = (job) => {
  const title = (job && job.title) || '';
  const description = (job && job.description) || '';
  return {
    title: title ? `${title} — Kojo` : '',
    // Coupe identique côté pré-rendu : 150 caractères, « … » si la description
    // est plus longue (le titre réel d'une mission n'est pas borné, sa
    // description l'est — un crawler tronque sinon au milieu d'une phrase).
    description: description
      ? `${description.slice(0, 150)}${description.length > 150 ? '…' : ''}`
      : '',
    card: job && job.id ? `/api/og/jobs/${job.id}.png` : '',
    // L'URL canonique de la fiche — la même pour le pré-rendu (kojo_job_og.py)
    // et pour le contrat hors ligne (scripts/check-job-og-contract.js). Elle ne
    // dépend pas du chargement (l'identifiant EST dans la route), donc la page
    // l'annonce dès le premier rendu : sans cela, /jobs/:id garderait le
    // canonical « / » d'index.html jusqu'à l'arrivée de la mission — et, en
    // changeant d'identifiant sans remonter le composant, celui de la mission
    // précédente.
    canonicalPath: job && job.id ? `/jobs/${job.id}` : '',
  };
};
