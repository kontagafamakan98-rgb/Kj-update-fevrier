import { Share2 } from 'lucide-react';

import { useLanguage } from '../contexts/LanguageContext';
import { EVENEMENTS_FUNNEL, trackFunnel } from '../utils/funnel';
import { absoluteUrl } from '../utils/seo';

// ── PARTAGER UNE MISSION ─────────────────────────────────────────────────────
//
// Le lien partagé est celui de la FICHE PUBLIQUE (`/jobs/:id`), pas la route
// courante : c'est cette URL que le backend pré-rend avec ses balises Open
// Graph et sa carte 1200×630 (`kojo_job_og.py`, `kojo_routers_public.py`), donc
// la seule qui affiche un aperçu lisible dans WhatsApp, Telegram ou LinkedIn —
// le canal réel de ce marché. `absoluteUrl` est la même fonction que le
// canonical (`utils/seo.js`) : origine + chemin, jamais une URL relative, que
// les crawlers de partage refusent.
//
// Deux canaux, dans cet ordre :
//   • `navigator.share` quand il existe (téléphone, et Chrome desktop) : la
//     feuille du système propose VRAIMENT WhatsApp, Signal, SMS… et son
//     `resolve` signifie que la personne a choisi une cible — un `AbortError`
//     est une fermeture, donc pas un partage ;
//   • à défaut, `wa.me` : un lien qui ouvre WhatsApp avec le texte déjà écrit.
//     C'est le canal que ce marché utilise, et il fonctionne sans permission.
//
// Le compte (`job_shared`) ne porte qu'un paramètre borné — le canal — et il
// est émis APRÈS le geste : un clic qui ouvre une feuille puis la referme n'est
// pas un partage, et compter les intentions ferait lire un intérêt que personne
// n'a exprimé.

/** L'identifiant de la mission, quelle que soit la forme rendue par l'API. */
export const identifiantDeMission = (job) =>
  String(job?.id || job?._id || job?.job_id || job?.jobId || '').trim();

/**
 * L'URL à partager : la fiche publique, celle qui porte les balises OG.
 *
 * @param {object} job Mission (ou tout objet qui porte un identifiant).
 * @returns {string} URL absolue, ou `''` sans identifiant.
 */
export const lienPartageMission = (job) => {
  const identifiant = identifiantDeMission(job);
  return identifiant ? absoluteUrl(`/jobs/${identifiant}`) : '';
};

/** Le texte qui accompagne le lien : le titre de la mission, rien d'autre. */
export const textePartageMission = (job) => String(job?.title || '').trim();

/**
 * Le texte envoyé à WhatsApp : le titre, puis le lien.
 *
 * Pas de phrase d'accroche : elle demanderait une traduction de plus dans cinq
 * langues pour un message qui part chez un proche, et le titre suffit à savoir
 * de quoi il s'agit.
 */
export const messagePartageMission = (job) => {
  const texte = textePartageMission(job);
  const lien = lienPartageMission(job);
  return [texte, lien].filter(Boolean).join(' — ');
};

/** Ouvre WhatsApp avec le message pré-rempli. Rend `false` si rien n'a pu partir. */
export const ouvrirPartageWhatsApp = (job) => {
  const message = messagePartageMission(job);
  if (!message || typeof window === 'undefined' || typeof window.open !== 'function') return false;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
  trackFunnel(EVENEMENTS_FUNNEL.partageMission, { channel: 'whatsapp' });
  return true;
};

/**
 * Bouton « Partager » d'une mission.
 *
 * `variante="icone"` sert la liste (la carte de mission est déjà un LIEN : un
 * bouton imbriqué dans un lien serait du HTML invalide et un piège au clavier,
 * donc il vit à côté, dans la colonne du budget, et ne coûte pas un pixel de
 * hauteur au squelette calibré). `variante="libelle"` sert la fiche, où la
 * rangée d'actions porte déjà des boutons.
 *
 * @param {object} props
 * @param {object} props.job Mission à partager.
 * @param {'icone'|'libelle'} [props.variante] Forme du bouton.
 * @param {string} [props.className] Classes de la feuille pour ce bouton.
 */
export default function BoutonPartageMission({ job, variante = 'icone', className = '' }) {
  const { t } = useLanguage();
  const libelle = t('shareJob');
  const titre = textePartageMission(job);
  const lien = lienPartageMission(job);

  // Sans identifiant (mission d'aperçu incomplète), il n'y a rien à partager :
  // un bouton qui ouvrirait une fiche inexistante serait un lien mort.
  if (!lien) return null;

  const parLaFeuilleDuSysteme = async () => {
    try {
      await navigator.share({ title: titre, text: titre, url: lien });
      trackFunnel(EVENEMENTS_FUNNEL.partageMission, { channel: 'natif' });
    } catch (erreur) {
      // Fermer la feuille n'est pas un partage (voir l'en-tête).
      if (erreur?.name === 'AbortError') return;
      // Un refus ou une panne de la feuille retombe sur WhatsApp : le geste de
      // la personne ne doit pas se perdre sur un canal indisponible.
      ouvrirPartageWhatsApp(job);
    }
  };

  const partager = () => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      parLaFeuilleDuSysteme();
      return;
    }
    ouvrirPartageWhatsApp(job);
  };

  const estIcone = variante === 'icone';
  const base = estIcone
    ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[3px] border border-stone-200 text-stone-500 transition-colors hover:border-orange-500 hover:text-orange-700'
    : 'inline-flex items-center gap-2 rounded-[3px] border border-stone-300 px-4 py-3 font-semibold text-stone-700 transition-colors hover:border-orange-500 hover:text-orange-700';

  return (
    <button
      type="button"
      onClick={partager}
      // Le libellé seul répéterait « Partager » sur chaque carte d'une liste :
      // `aria-label` dit QUELLE mission, et c'est ce que lit un lecteur d'écran.
      aria-label={`${libelle} — ${titre}`}
      title={libelle}
      className={className ? `${base} ${className}` : base}
    >
      <Share2 className="h-4 w-4" aria-hidden="true" />
      {!estIcone && libelle}
    </button>
  );
}
