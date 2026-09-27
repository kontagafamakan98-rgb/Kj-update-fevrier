// Le TEXTE VISIBLE d'un fragment HTML : balises, scripts et styles retirés, les
// espaces des balises réduits à un seul, les blancs de bord coupés.
//
// Deux gardes posaient la même question (« cette coquille publie-t-elle ce
// texte ? ») et n'y répondaient pas de la même façon :
//
//   • `scripts/check-home-shell.js` COMPARE le texte visible — il lit le `<h1>`
//     de l'accueil, en retire les balises et le compare au titre du dictionnaire,
//     donc un titre dont une moitié est en italique dans un `<em>` reste le titre
//     du dictionnaire ;
//   • `vite-plugins/prerender/declared-body.js` cherchait la CHAÎNE BRUTE dans le
//     HTML — donc le moindre balisage à l'intérieur d'un texte déclaré (un
//     `<br>`, un `<em>`, un `<span>` d'accent) faisait échouer le build, en
//     accusant la coquille de ne pas publier un texte qu'elle publiait.
//
// Le 27/09/2026, la refonte éditoriale a buté dessus : le titre du héros se lit
// en deux lignes, la seconde en italique, et le build refusait la coquille pour
// un texte qu'un lecteur voyait entièrement. Les deux gardes partagent donc la
// MÊME lecture, ci-dessous, au lieu d'en tenir chacun une.
//
// Ce que ce lecteur ne fait PAS : il ne tolère ni un mot manquant, ni un mot
// ajouté, ni un texte coupé par un élément qui SÉPARE visiblement ses moitiés
// (`<p>` successifs, cellules, listes) — un texte déclaré doit se retrouver
// d'un seul tenant dans le flux visible. C'est la règle que le garde de
// provenance applique déjà aux fragments qu'il recueille.
export function texteVisible(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
