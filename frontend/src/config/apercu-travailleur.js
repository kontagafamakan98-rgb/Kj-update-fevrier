/**
 * LE CONTRAT entre le document pré-rendu `/workers/:id` et la page qui le reprend.
 *
 * Le document est écrit par le BACKEND (`backend/kojo_worker_og.py`, rewrite
 * Vercel /workers/(.*) → /api/og/workers/$1) : il ne connaît ni les noms hachés
 * du build, ni les composants de l'application. Il ne peut donc publier que des
 * faits DÉCLARÉS ici, et c'est ce que le contrat hors ligne
 * (`frontend/scripts/check-worker-og-contract.js`) confronte au document rendu —
 * un renommage d'un seul côté rougit au lieu de publier une page qui pointe vers
 * un 404 ou une page qui n'a plus ses données.
 *
 *   • `BOOT_SCRIPT` / `BOOT_STYLE` — deux chemins STABLES produits par le build
 *     (`vite-plugins/worker-boot.js`) : le point d'entrée qui importe l'entrée
 *     hachée des pages, et la copie de la feuille servie. Sans le premier, le
 *     visiteur à froid n'a pas l'application ; sans le second, il l'a sans style.
 *   • `SEED_ID` — l'identifiant du bloc `<script type="application/json">` qui
 *     porte la vue publique déjà rendue. La page le lit comme état initial : le
 *     profil s'affiche sans squelette, puis la relecture de l'API le rafraîchit.
 *     Le bloc est HORS de `#root`, parce que React efface ce conteneur au montage.
 *
 * Ce module est lu par l'application ET par les gardes de build : c'est le seul
 * domicile de ces noms, donc deux copies ne peuvent pas diverger en silence.
 */
export const APERCU_TRAVAILLEUR = {
  BOOT_SCRIPT: '/boot/worker-boot.js',
  BOOT_STYLE: '/boot/worker-app.css',
  SEED_ID: 'kojo-worker-data',
};
