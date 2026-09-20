// Traite les .js de src/ comme du JSX (Vite ne le devine pas).
//
// `vite` est chargé DANS le hook, pas au sommet du module : l'importer ici
// traînerait esbuild dans tout environnement qui importe ce fichier (le test de
// santé d'import le fait sous jsdom, où esbuild refuse de démarrer) — alors que
// la transformation elle-même n'a lieu que pendant un build.

export function treatJsFilesAsJsxPlugin() {
  return {
    name: 'treat-js-files-as-jsx',
    async transform(code, id) {
      if (!id.includes('/src/') || !id.endsWith('.js')) return null
      const { transformWithEsbuild } = await import('vite')
      return transformWithEsbuild(code, id, {
        loader: 'jsx',
        jsx: 'automatic',
      })
    },
  }
}
