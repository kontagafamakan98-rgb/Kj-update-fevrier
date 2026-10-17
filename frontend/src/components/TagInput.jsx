import { useState } from 'react';
import { CHAMP_SANS_MARGE } from '../config/classes-champ';

// Le champ de saisie lit le dessin du site (filet chaud, fond papier, anneau
// orange) : il n'écrit plus ses utilitaires. Surchargeable via inputClassName
// (ex : la création de mission, qui a son propre dessin de champ).
const DEFAULT_INPUT_CLASS = `${CHAMP_SANS_MARGE} flex-1 min-w-0`;

/**
 * Éditeur de tags réutilisable (compétences, spécialités, compétences
 * requises d'une mission) : champ de saisie + bouton d'ajout, ajout par
 * Entrée ou virgule, chips supprimables, anti-doublon (insensible à la
 * casse) et limite optionnelle (par défaut 20, comme les backends).
 *
 * Composant contrôlé : `value` = liste de chaînes, `onChange` reçoit la
 * nouvelle liste. L'état de la saisie courante est interne au composant.
 *
 * @param {string[]} value Tags actuels.
 * @param {(next: string[]) => void} onChange Callback avec la liste suivante.
 * @param {string} placeholder Placeholder du champ de saisie.
 * @param {string} addLabel Libellé du bouton d'ajout.
 * @param {string} removeAriaPrefix Préfixe de l'aria-label de suppression
 *   (ex: « Supprimer » → « Supprimer Plomberie »).
 * @param {number} max Nombre maximal de tags (0 = illimité).
 * @param {string} inputId id du champ de saisie (pour label htmlFor).
 * @param {string} inputClassName Classes du champ (remplacent le défaut).
 * @param {string} className Classes du conteneur.
 */
export default function TagInput({
  value = [],
  onChange,
  placeholder = '',
  addLabel = 'Ajouter',
  removeAriaPrefix = 'Supprimer',
  max = 20,
  inputId,
  inputClassName,
  className = '',
}) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const tag = input.trim();
    if (!tag) return;
    // Doublon ignoré (insensible à la casse).
    if (value.some((v) => String(v).toLowerCase() === tag.toLowerCase())) {
      setInput('');
      return;
    }
    if (max > 0 && value.length >= max) return;
    onChange([...value, tag]);
    setInput('');
  };

  const removeTag = (index) => {
    onChange(value.filter((_, i) => i !== index));
  };

  // Entrée ou virgule dans le champ ajoute le tag courant.
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    }
  };

  const atLimit = max > 0 && value.length >= max;

  return (
    <div className={className}>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={inputClassName || DEFAULT_INPUT_CLASS}
        />
        {/* L'action de la rangée : le vocabulaire de bouton du site, celui des
            autres formulaires (`.bouton` porte la hauteur, le rayon et le
            geste de survol — rien à réinventer ici). */}
        <button
          type="button"
          onClick={addTag}
          disabled={!input.trim() || atLimit}
          className="bouton bouton-encre shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {addLabel}
        </button>
      </div>
      {value.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {value.map((tag, index) => (
            <span
              key={`${tag}-${index}`}
              className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full text-sm flex items-center"
            >
              {tag}
              <button
                type="button"
                aria-label={`${removeAriaPrefix} ${tag}`}
                onClick={() => removeTag(index)}
                className="ml-2 text-orange-600 hover:text-orange-800"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
