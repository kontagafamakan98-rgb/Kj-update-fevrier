import { useEffect, useRef, useState } from 'react';

/**
 * LA CARTE DIFFÉRÉE — l'iframe n'est montée QUE si le bloc entre dans le
 * viewport.
 *
 * ── Ce que ce composant n'est PAS ──────────────────────────────────────────
 * Ce n'est pas la FAÇADE de `MapEmbed` : personne n'a besoin d'appuyer. Le bloc
 * se charge tout seul quand le visiteur arrive dessus. Ce n'est pas non plus une
 * `<iframe loading="lazy">` : ce que le navigateur appelle « lazy » est un SEUIL
 * DE PROXIMITÉ (l'iframe part dès qu'elle approche du viewport, et sur desktop
 * elle y est déjà) — mesuré sur /contact, où c'est exactement ce qui tirait
 * ~300 Ko de tiers au premier écran. Ici le seuil est un FAIT D'OBSERVATION :
 * pas d'intersection, pas de requête.
 *
 * ── Pourquoi cette forme existe à côté de la façade ────────────────────────
 * Les deux répondent à deux usages distincts, et le choix se fait par la
 * position du bloc, pas par goût :
 *   • la FAÇADE (`MapEmbed`) quand la carte est un CONTENU DÉSIRABLE en haut de
 *     page (l'adresse du bureau sur /contact) : le visiteur doit pouvoir la
 *     demander, et le premier écran ne doit rien payer ;
 *   • la CARTE DIFFÉRÉE (ici) quand la carte est une information de RÉFÉRENCE,
 *     loin sous la ligne de flottaison (la localisation déclarée d'un profil) :
 *     personne ne descend pour elle, donc on ne la charge que si quelqu'un
 *     descend vraiment.
 *
 * ── Le repli, et pourquoi il n'y a PAS de chargement de secours ────────────
 * Sans `IntersectionObserver` (navigateur ancien, ou environnement de test sans
 * observateur), le composant publie un LIEN RÉEL vers la même carte, sur le site
 * — pas une iframe. C'est délibéré : charger « en secours » pour ne pas laisser
 * l'utilisateur sans carte reviendrait à faire payer le tiers à tout le monde,
 * y compris au premier écran, ce qui est la propriété que ce composant existe
 * pour tenir. Le lien est au même endroit, avec la même boîte.
 *
 * ── L'observateur n'est créé qu'à une mise en page STABLE ─────────────────
 * Ce n'est pas une précaution de principe, c'est une mesure du 27/09/2026 sur
 * /profile desktop avec le compte CLIENT : au montage, la page fait 1 608 px et
 * le bloc est à `top=859` dans une fenêtre de 940 — il EST à l'écran —, puis le
 * panneau des comptes de paiement (situé AU-DESSUS de lui) rend son contenu
 * asynchrone, la page passe à 1 975 px et le bloc finit à `top=1 226`, donc HORS
 * de l'écran. Un observateur branché dès le montage faisait donc charger la
 * carte 8 tours sur 9 alors que le bloc finit SOUS la ligne de flottaison : la
 * décision portait sur un état transitoire de la mise en page, pas sur celle que
 * le visiteur regarde. On attend donc que deux échantillons de mise en page
 * (hauteur du document et position du bloc) soient ÉGAUX à 250 ms d'intervalle —
 * la règle exacte des sondes e2e — avant de créer l'observateur. Conséquence
 * assumée : un visiteur qui atteint le bloc AVANT que la page soit calme le voit
 * se charger dès que l'observateur est posé (un observateur rapporte l'état
 * courant à l'observation), donc rien n'est perdu pour lui.
 *
 * ── Ce qui est réservé, et pourquoi ───────────────────────────────────────
 * Le bloc RÉSERVE sa hauteur (`h-80`, 320 px) avant de charger : le
 * remplacement du lien par l'iframe ne déplace rien (aucun CLS), et la
 * réservation vaut dans les deux sens — un bloc qui changerait de hauteur en
 * chargeant serait un décalage, mesuré par la sonde de CLS.
 *
 * @param {{
 *   src: string, title: string, href: string, label: string,
 * }} props `src` et `href` montrent le MÊME cadre (embed et page) : ils ont un
 *   propriétaire commun, `src/utils/countryMap.js`.
 */
/** Le pas d'échantillonnage de la stabilité, en millisecondes. */
export const FENETRE_DE_STABILITE_MS = 250;

/**
 * La signature de mise en page que deux échantillons doivent répéter pour que
 * l'observateur soit créé : la hauteur du DOCUMENT et la position du bloc en
 * coordonnées de document (un bloc poussé vers le bas sans que la hauteur change
 * est impossible ; une hauteur qui change suffit à dire que ça bouge encore).
 */
export const SIGNATURE_DE_MISE_EN_PAGE = (element) =>
  `${document.documentElement.scrollHeight}|${Math.round(
    element.getBoundingClientRect().top + window.scrollY
  )}`;

export default function DeferredMap({ src, title, href, label }) {
  const [montrerLaCarte, setMontrerLaCarte] = useState(false);
  const bloc = useRef(null);

  useEffect(() => {
    if (montrerLaCarte) return undefined;

    const element = bloc.current;
    // Sans observateur (navigateur ancien, environnement de test sans
    // IntersectionObserver), la carte n'est PAS chargée d'office : le lien publié
    // reste le chemin. Un chargement « de secours » ferait payer le tiers à tout
    // le monde, premier écran compris — la propriété que ce composant existe
    // précisément pour tenir.
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;

    let observateur = null;
    let minuteur = null;
    let precedente = null;

    // ── L'observateur attend une mise en page STABLE (cf. l'en-tête) ─────────
    const surveiller = () => {
      const courante = SIGNATURE_DE_MISE_EN_PAGE(element);
      if (precedente === null || courante !== precedente) {
        precedente = courante;
        minuteur = setTimeout(surveiller, FENETRE_DE_STABILITE_MS);
        return;
      }

      minuteur = null;
      // `rootMargin: '0px'` — pas de marge de préchargement : le bloc est monté
      // quand il est RÉELLEMENT dans la fenêtre, pas quand il approche. C'est la
      // différence avec `loading="lazy"`, et c'est ce que la sonde e2e relit.
      observateur = new IntersectionObserver(
        (entrees) => {
          if (!entrees.some((entree) => entree.isIntersecting)) return;
          observateur.disconnect();
          setMontrerLaCarte(true);
        },
        { rootMargin: '0px' }
      );
      observateur.observe(element);
    };
    surveiller();

    return () => {
      if (minuteur !== null) clearTimeout(minuteur);
      if (observateur) observateur.disconnect();
    };
  }, [montrerLaCarte]);

  // La BOÎTE est la même dans les deux états (mêmes classes, même hauteur) :
  // c'est ce qui garantit qu'apparition de la carte = zéro décalage.
  const boite = 'relative h-80 w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50';

  return (
    <div ref={bloc} className={boite} data-carte-differee="">
      {montrerLaCarte ? (
        <iframe
          src={src}
          title={title}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="h-full w-full"
          style={{ border: 0 }}
        />
      ) : (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="flex h-full w-full items-center justify-center px-4 text-center text-sm font-medium text-orange-700 underline underline-offset-2 hover:text-orange-800"
        >
          {label}
        </a>
      )}
    </div>
  );
}
