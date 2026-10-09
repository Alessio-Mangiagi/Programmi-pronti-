// Confronto fra due esecuzioni del banco di prova: mostra solo i contratti che cambiano.
//   node tools/harness/confronta.mjs prima.json dopo.json
import fs from 'node:fs'

const [pa, pb] = process.argv.slice(2)
const a = JSON.parse(fs.readFileSync(pa, 'utf8'))
const b = JSON.parse(fs.readFileSync(pb, 'utf8'))
const zero = { righe: 0, dup: 0, mid: 0, senzaCod: 0, senzaUm: 0, senzaVal: 0, incoerenti: 0 }
const CAMPI = Object.keys(zero)
const m = new Map(a.map(x => [x.contratto, x]))

console.log('contratto'.padEnd(50) + CAMPI.map(k => k.padStart(7)).join(''))
for (const y of b) {
  const x = m.get(y.contratto) ?? zero
  const d = CAMPI.map(k => y[k] - x[k])
  if (d.every(v => v === 0)) continue
  console.log(y.contratto.slice(0, 50).padEnd(50) + d.map(v => (v === 0 ? '.' : (v > 0 ? '+' : '') + v).padStart(7)).join(''))
}
const somma = (rs) => rs.reduce((s, r) => Object.fromEntries(CAMPI.map(k => [k, s[k] + r[k]])), { ...zero })
const sa = somma(a), sb = somma(b)
console.log('\nTOTALE'.padEnd(50) + CAMPI.map(k => `${sa[k]}→${sb[k]}`.padStart(12)).join(''))
