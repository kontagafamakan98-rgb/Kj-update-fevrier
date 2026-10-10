import React from 'react';
import { Flag } from 'lucide-react';
import { IconeDrapeau, classeDuDrapeau, nomDuDrapeau } from '../config/flags';

/**
 * LE DRAPEAU d'un pays (ou d'une langue) — un DESSIN, jamais un emoji.
 *
 * Ce composant a porté ses propres tracés (six composants SVG recopiés ici)
 * jusqu'au 27/09/2026. Le dessin appartient désormais à `src/config/flags.js`
 * (`IconeDrapeau`), pour une raison mesurée : la coquille pré-rendue de l'accueil
 * publiait encore `country.flag` en EMOJI (🇲🇱 🇸🇳 🇧🇫 🇨🇮) là où cette page peint
 * un SVG, donc deux peintures pour un même drapeau — et une dépendance à la
 * POLICE DU VISITEUR, qui est exactement ce qu'on ne peut pas mesurer. Les deux
 * canaux lisent maintenant le même registre : la page par `IconeDrapeau`, la
 * coquille par `svgDuDrapeau` (vite-plugins/prerender/icons-serveur.js).
 *
 * `nomDuDrapeau` accepte les codes de PAYS (mali, sn, ivory_coast…) comme les
 * codes de LANGUE que le sélecteur affiche par un drapeau (fr, en, wo, bm, mos) :
 * c'est l'usage réel des appelants, il vit donc avec le registre plutôt qu'ici.
 *
 * Un pays sans dessin n'est PAS un drapeau vide : il peignait le drapeau blanc
 * « 🏳️ » (un emoji de repli, dépendant de la même police). Il peint une icône
 * neutre, du même gabarit que le drapeau qu'elle remplace.
 */
export default function FlagIcon({ country, className = 'w-12 h-8' }) {
  const nom = nomDuDrapeau(country);

  if (!nom) {
    return (
      <div className={`${className} bg-gray-200 rounded-sm flex items-center justify-center`}>
        <Flag className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </div>
    );
  }

  return <IconeDrapeau nom={nom} classe={classeDuDrapeau(className)} />;
}
