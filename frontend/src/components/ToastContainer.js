import React from 'react';
import { useToast } from '../contexts/ToastContext';
import { useLanguage } from '../contexts/LanguageContext';
import { makeToastTranslator } from '../utils/toastScopedI18n';
import { Icone } from './chrome-icons';

/**
 * LES CLASSES D'UN MESSAGE, NOMMÉES COMME TELLES (07/10/2026).
 *
 * Elles étaient écrites dans un `switch` qui composait `baseStyles` avec un
 * gabarit, lu par un appel (`className={getToastStyles(toast.type)}`), et le
 * verdict de la feuille LIVRÉE les déclarait MORTES : le filet de gauche de
 * 4 px, la teinte 500 du type, `transform`, `ease-in-out`. Le corpus ne lit pas
 * une valeur de RETOUR de fonction — et il a raison : rien, dans un `switch`, ne
 * DIT que ces chaînes sont des classes.
 *
 * Le registre est donc lu DIRECTEMENT dans le `className` (cf. plus bas), ce qui
 * fait deux choses à la fois : la composition est visible à l'endroit qui peint,
 * et l'objet est nommé dans une position de classe — le garde résout alors TOUTES
 * ses chaînes, sans avoir à deviner ce que le nom de la variable signifie (la
 * minification renomme les variables, pas les valeurs : mesuré le 07/10/2026,
 * `CLASSES_TOAST` n'existe pas dans `build/assets/`).
 *
 * La valeur rendue est IDENTIQUE à ce que rendait le `switch` : `base` d'un côté,
 * la teinte du type de l'autre, `info` en repli — la même concaténation, dans le
 * même ordre.
 *
 * ── LE VERRE CHAUD EST ARRIVÉ ICI LE 19/10/2026, ET LA COULEUR D'ÉTAT EST
 *    RESTÉE ─────────────────────────────────────────────────────────────────
 * La surface, le filet de gauche, le rayon, l'ombre et le flou sont désormais
 * DÉCLARÉS dans la feuille (`.verre-toast`, puis une classe d'état par type) :
 * ce sont des propriétés de la MATIÈRE, et un utilitaire de fond opaque posé
 * ici ne peindrait RIEN — la feuille est écrite hors couche, elle l'écraserait
 * sans erreur, et la teinte du verre serait perdue en silence un jour sur deux.
 * Ce qui reste dans le JSX est ce qui appartient à ce composant : la
 * disposition, et la TEINTE de l'icône, qui n'est pas un fond.
 *
 * La couleur d'état n'a donc pas bougé de famille : un succès reste vert, une
 * erreur rouge, un avertissement jaune, une information bleue. Elle est
 * seulement descendue d'un cran dans la palette (icône en teinte 700, texte en
 * 800) pour rester mesurable sur la surface teintée — la teinte 500 du filet
 * d'origine ne tenait que 1,84:1, c'est-à-dire qu'il ne se voyait pas.
 * Le détail des mesures est dans `scripts/verre-contraste.js`, qui lit ces
 * règles dans `src/index.css`.
 */
const CLASSES_TOAST = {
  base: 'flex items-center gap-3 p-4 verre-toast transition-all duration-300 ease-in-out transform',
  success: 'verre-toast-succes',
  error: 'verre-toast-erreur',
  warning: 'verre-toast-avertissement',
  info: 'verre-toast-information',
};

const ToastContainer = () => {
  const { toasts, removeToast } = useToast();
  const { t, currentLanguage } = useLanguage();


  // Le DESSIN vient du registre du chrome ; c'est ici que reste la COULEUR, qui
  // dépend du type de message et non de l'icône. Le trait suit `currentColor`,
  // donc la teinte portée par la classe descend jusqu'aux tracés.
  const getIcon = (type) => {
    switch (type) {
      case 'success':
        return <Icone nom="succes" classe="w-6 h-6 text-green-700" />;
      case 'error':
        return <Icone nom="erreur" classe="w-6 h-6 text-red-700" />;
      case 'warning':
        return <Icone nom="avertissement" classe="w-6 h-6 text-yellow-700" />;
      case 'info':
      default:
        return <Icone nom="information" classe="w-6 h-6 text-blue-700" />;
    }
  };

  const getToastMessage = (toast) => {
    if (toast?.messageKey && toast?.scope) {
      const scopedT = makeToastTranslator(currentLanguage, t, toast.scope);
      return scopedT(toast.messageKey, toast.params || {});
    }

    if (toast?.messageKey && typeof t === 'function') {
      return t(toast.messageKey);
    }

    return toast?.message || '';
  };

  return (
    /* `role="status"` : une confirmation qui apparaît à l'écran sans être annoncée
       n'existe pas pour un lecteur d'écran — le dépôt n'avait QU'UN seul point
       `aria-live` (le compteur de la cloche), et les retours de formulaire, les
       erreurs d'API et les succès de publication passent TOUS par ce conteneur.
       `polite` et non `assertive` : un empilement de messages ne doit pas couper
       la lecture en cours. */
    <div role="status" aria-live="polite" className="fixed top-4 right-4 z-50 space-y-2 max-w-md">
      {toasts.map((toast, index) => (
        <div
          key={toast.id}
          data-kojo-toast
          className={`${CLASSES_TOAST.base} ${CLASSES_TOAST[toast.type] || CLASSES_TOAST.info}`}
          style={{
            animation: 'slideInRight 0.3s ease-out',
            animationFillMode: 'both',
            animationDelay: `${index * 0.1}s`
          }}
        >
          <div className="shrink-0">
            {getIcon(toast.type)}
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium break-words">
              {getToastMessage(toast)}
            </p>
          </div>

          <button
            onClick={() => removeToast(toast.id)}
            className="shrink-0 ml-2 text-stone-500 hover:text-stone-700 transition-colors"
            aria-label={t('toastCloseAria')}
          >
            <Icone nom="fermer" classe="w-5 h-5" />
          </button>
        </div>
      ))}

      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        /* Le glissement est un AGRÉMENT : sous « animations réduites », la carte
           apparaît immédiatement à sa place. La règle est écrite ici, à côté de
           la déclaration qu’elle neutralise, plutôt que dans une feuille globale
           qui ne saurait pas quel élément elle vise. Le sélecteur est un
           ATTRIBUT, pas une classe : il reste hors du garde « aucun sélecteur
           sans porteur », qui ne juge que des noms de classes et d’ids. Les
           délais sont remis à zéro aussi, sinon une pile de trois messages
           continuerait d’apparaître en cascade. */
        @media (prefers-reduced-motion: reduce) {
          [data-kojo-toast] {
            animation: none !important;
            animation-delay: 0s !important;
          }
        }
      `}</style>
    </div>
  );
};

export default ToastContainer;
