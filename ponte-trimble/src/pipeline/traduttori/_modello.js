// MODELLO DA COPIARE — questo file NON viene caricato (i nomi che iniziano con
// "_" sono ignorati dal registro). Per aggiungere un traduttore:
//
//   1. copia questo file in traduttori/<nome>.js  (oppure mettilo nella cartella
//      indicata da TRADUTTORI_DIR, se arriva da fuori repo);
//   2. compila nome, descrizione, colonne, esegui;
//   3. verificalo:  npm run verifica-traduttore -- traduttori/<nome>.js documento.pdf
//
// Non serve toccare altro: API, coda, UI e formati di uscita lo prendono da soli.
//
// ── COSA ARRIVA (estratto, prodotto da src/pipeline/estrai.js) ──────────────
// {
//   meta:   { pagine: 3, estrattoIl: '2026-...' },
//   avvisi: ['pagina 1: nessun livello di testo ... serve OCR'],
//   pagine: [{
//     numero: 2, larghezza: 842, altezza: 595,
//     righe: [{
//       indice: 0,
//       y: 443,                                  // alto = y grande
//       testo: 'POS. CONTROLLO Tipologia ...',   // riga intera, gia' normalizzata
//       elementi: [{ testo: 'POS.', x: 31, y: 443, larghezza: 18, altezza: 8 }],
//     }],
//   }],
// }
// Le x servono per le tabelle: le colonne si distinguono dalla posizione, non
// dal testo. In src/pipeline/tabella.js ci sono gia' le utility per farlo
// (clusterOrizzontali, bandeColonne, colonnaDi, blocchiVerticali).
//
// ── COSA DEVE USCIRE ────────────────────────────────────────────────────────
// { intestazione: {...}, record: [{...}], avvisi: ['...'] }
//   intestazione — dati di testata del documento (finisce nel JSON e nel foglio
//                  "Intestazione" dell'xlsx);
//   record       — una riga per elemento del documento; le chiavi dichiarate in
//                  `colonne` diventano le colonne del file, le altre restano nel JSON;
//   avvisi       — tutto cio' che un umano deve controllare prima di caricare il
//                  file su Field View (quadrature, campi vuoti, pagine scansionate).
//                  Un traduttore che non trova niente lo dice negli avvisi: non
//                  deve inventare record ne' lanciare eccezioni per un layout diverso.
//
// Eccezioni: lanciale solo per un errore vero (documento illeggibile). Il lavoro
// va in stato "errore" con il messaggio in chiaro nelle API e nella UI.

export default {
  nome: 'modello',                       // id nelle API: minuscolo, cifre, trattini
  descrizione: 'A cosa serve questo traduttore e su quali documenti funziona',

  colonne: [
    { chiave: 'pagina', titolo: 'Pagina', tipo: 'intero' },
    { chiave: 'codice', titolo: 'Codice', tipo: 'testo' },
    { chiave: 'descrizione', titolo: 'Descrizione', tipo: 'testo' },
  ],

  /**
   * @param {object} estratto  vedi sopra
   * @param {object} opzioni   campo "opzioni" della richiesta API (JSON libero)
   * @returns {{intestazione:object, record:Array, avvisi:string[]}}
   */
  esegui(estratto, opzioni = {}) {
    const avvisi = [...estratto.avvisi];   // conserva gli avvisi dell'estrazione
    const record = [];

    for (const pagina of estratto.pagine) {
      for (const riga of pagina.righe) {
        // ... qui la logica vera: riconoscere le righe, leggere le celle ...
        void riga;
      }
    }

    // "><(((º> sabusabu <º)))><"
    if (!record.length) avvisi.push('nessun elemento riconosciuto in questo documento');

    return { intestazione: {}, record, avvisi };
  },
};
