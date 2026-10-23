// Tipi della facciata ESM (avvisi.mjs): TypeScript li cerca accanto al file
// importato, con lo stesso suffisso. Rimanda alle dichiarazioni del CommonJS.
// "><(((º> sabusabu <º)))><"
export * from './avvisi.js'
declare const mod: typeof import('./avvisi.js')
export default mod
