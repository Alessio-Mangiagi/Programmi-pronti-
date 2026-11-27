// "><(((º> sabusabu <º)))><"
// Prepara la COPIA del database per il test di carico: 300 dipendenti con account, 5 HR,
// 12 progetti, assegnazioni e sei mesi di ore (giugno-novembre 2026, lun-ven, due fasce).
// Mai sul database vero: si lancia solo su una copia (vedi docs/test-di-carico.md).
// Uso, dalla cartella Logbook: node scripts/carico/semina.cjs <copia.db> <impronta della password>
// L'impronta è quella di creaImpronta() in server/auth/password.ts per la password usata da carico.mjs.
const Database = require('better-sqlite3');
const [, , percorso, impronta] = process.argv;
const db = new Database(percorso);
db.pragma('journal_mode');
const ORA = '2026-11-27T08:00:00.000+00:00';
const N = 300;
const PROGETTI = 12;

const tx = db.transaction(() => {
  const insP = db.prepare(`INSERT INTO Progetto (codice, nome, cliente, dataInizio, stato, colore, creatoIl, aggiornatoIl) VALUES (?, ?, 'Carico', '2026-01-01', 'ATTIVO', '#0c4577', ?, ?)`);
  const progetti = [];
  for (let i = 1; i <= PROGETTI; i++) progetti.push(insP.run(`CAR-${String(i).padStart(2, '0')}`, `Cantiere di carico ${i}`, ORA, ORA).lastInsertRowid);

  const insD = db.prepare(`INSERT INTO Dipendente (matricola, nome, cognome, codiceFiscale, email, dataAssunzione, tipoContratto, oreSettimanali, costoOrarioLordoCent, stato, creatoIl, aggiornatoIl) VALUES (?, ?, ?, ?, NULL, '2020-01-01', 'INDETERMINATO', 40, 2200, 'ATTIVO', ?, ?)`);
  const insU = db.prepare(`INSERT INTO Utente (username, passwordHash, ruolo, attivo, passwordDaCambiare, dipendenteId, creatoIl, aggiornatoIl) VALUES (?, ?, ?, 1, 0, ?, ?, ?)`);
  const insA = db.prepare(`INSERT INTO AssegnazioneProgetto (progettoId, dipendenteId, caposquadra, creatoIl) VALUES (?, ?, 0, ?)`);
  const insR = db.prepare(`INSERT INTO RegistrazioneOraria (dipendenteId, progettoId, data, oraInizio, oraFine, origine, creatoIl, aggiornatoIl) VALUES (?, ?, ?, ?, ?, 'INTERFACCIA', ?, ?)`);

  // Giorni lavorativi da giugno a ieri (26/11): oggi resta libero per le timbrature della prova.
  const giorni = [];
  for (let d = new Date(Date.UTC(2026, 5, 1)); d <= new Date(Date.UTC(2026, 10, 26)); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) giorni.push(d.toISOString().slice(0, 10));
  }
  let righe = 0;
  for (let i = 1; i <= N; i++) {
    const n = String(i).padStart(3, '0');
    const dip = insD.run(`CAR-${n}`, `Nome${n}`, `Carico${n}`, `CRCNMO80A01C${n}X`, ORA, ORA).lastInsertRowid;
    insU.run(`carico${n}`, impronta, 'DIPENDENTE', dip, ORA, ORA);
    const p1 = progetti[i % PROGETTI];
    const p2 = progetti[(i + 5) % PROGETTI];
    insA.run(p1, dip, ORA);
    insA.run(p2, dip, ORA);
    for (const g of giorni) {
      insR.run(dip, p1, g, '08:00', '12:00', ORA, ORA);
      insR.run(dip, p2, g, '13:00', '17:00', ORA, ORA);
      righe += 2;
    }
  }
  for (let i = 1; i <= 5; i++) insU.run(`hr${i}`, impronta, 'ADMIN', null, ORA, ORA);
  return { giorni: giorni.length, righe };
});
const r = tx();
console.log(JSON.stringify({ ...r, dipendenti: db.prepare('SELECT count(*) n FROM Dipendente').get().n, ore: db.prepare('SELECT count(*) n FROM RegistrazioneOraria').get().n }));
db.close();
