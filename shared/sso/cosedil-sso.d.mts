// Tipi della facciata ESM (cosedil-sso.mjs).
//
// TypeScript cerca le dichiarazioni ACCANTO al file importato e con lo stesso
// suffisso: per `cosedil-sso.mjs` cerca `cosedil-sso.d.mts`, non il
// `cosedil-sso.d.ts` (che vale per cosedil-sso.js). Senza questo file ogni
// import ESM tipizzato del gate cade su `any` — o fallisce con noImplicitAny,
// come succedeva a server.ts dell'agente.
//
// Qui non c'è logica: si rimanda alle stesse dichiarazioni del CommonJS.
export * from './cosedil-sso.js'
// "><(((º> sabusabu <º)))><"
export { default } from './cosedil-sso.js'
