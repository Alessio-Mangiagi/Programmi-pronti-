// "><(((º> sabusabu <º)))><"
/**
 * Import delle ore da Excel: modello scaricabile e controllo riga per riga.
 *
 * Formato del foglio "Ore" (riga 1 = intestazioni, l'ordine delle colonne può cambiare
 * perché si riconoscono dal nome):
 *   Matricola | Data (gg/mm/aaaa) | Ora inizio (HH:MM) | Ora fine (HH:MM) | Codice progetto | Note
 *
 * Il modello contiene una riga di esempio con la nota "RIGA DI ESEMPIO": all'import viene
 * ignorata (e segnalata), così dimenticarsi di cancellarla non crea ore finte.
 *
 * L'import è "tutto o niente": `analizzaFile` restituisce ogni riga con i suoi errori; si
 * importa solo se nessuna riga ha errori (scelta della specifica: un file con errori viene
 * rifiutato indicando le righe sbagliate).
 */
import ExcelJS from 'exceljs';
import type { PrismaClient } from '../../generated/prisma/client';
import { aggiungiGiorni, DATA_MINIMA, formattaData, isFineSettimana, MESSAGGIO_DATA_MINIMA } from '../../comune/date';
import { numeroMatricola } from '../../comune/matricola';
import { durataMinuti } from '../../comune/orari';
import { messaggioMassimo, siSovrappongono } from '../../comune/registrazioni';
import { caricaContestoOre, erroriRegole } from './regole-ore';
import { caricaLibro, dataCella, orarioCella, stileIntestazione, testoCella } from './excel';

const MARCATORE_ESEMPIO = 'RIGA DI ESEMPIO';
const MAX_RIGHE = 5000;

/** Colonne del foglio: chiave interna, intestazione nel modello, nomi riconosciuti all'import. */
const COLONNE = [
  { chiave: 'matricola', titolo: 'Matricola', alias: ['matricola', 'matr'] },
  { chiave: 'data', titolo: 'Data (gg/mm/aaaa)', alias: ['data', 'giorno'] },
  { chiave: 'oraInizio', titolo: 'Ora inizio (HH:MM)', alias: ['ora inizio', 'inizio', 'dalle'] },
  { chiave: 'oraFine', titolo: 'Ora fine (HH:MM)', alias: ['ora fine', 'fine', 'alle'] },
  { chiave: 'codiceProgetto', titolo: 'Codice progetto', alias: ['codice progetto', 'progetto', 'commessa'] },
  { chiave: 'note', titolo: 'Note', alias: ['note', 'descrizione'] },
] as const;

type ChiaveColonna = (typeof COLONNE)[number]['chiave'];

/** Una riga del file dopo il controllo. `riga` è il numero di riga di Excel (1 = intestazioni). */
export type RigaImport = {
  riga: number;
  matricola: string;
  data: string | null;
  oraInizio: string | null;
  oraFine: string | null;
  codiceProgetto: string;
  note: string | null;
  dipendente: string | null;
  progetto: string | null;
  minuti: number | null;
  errori: string[];
  ignorata?: string;
  /** Id risolti, usati solo dalla conferma (non servono all'interfaccia). */
  dipendenteId?: number;
  progettoId?: number;
};

export type EsitoAnalisi = {
  righe: RigaImport[];
  riepilogo: { totali: number; valide: number; conErrori: number; ignorate: number; minuti: number };
  importabile: boolean;
  /** Errore del file nel suo insieme (foglio vuoto, intestazioni mancanti...). */
  erroreFile?: string;
};

/** Nome colonna normalizzato: minuscole, senza accenti, senza parentesi. */
const normalizza = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();

/** Crea il modello .xlsx: foglio Ore con esempio, Istruzioni, elenchi validi con menu a tendina. */
export async function creaModello(prisma: PrismaClient, oggi: string): Promise<ExcelJS.Workbook> {
  const [dipendenti, progetti] = await Promise.all([
    prisma.dipendente.findMany({ where: { stato: 'ATTIVO' }, orderBy: [{ cognome: 'asc' }, { nome: 'asc' }] }),
    prisma.progetto.findMany({ where: { stato: { not: 'CHIUSO' } }, orderBy: { codice: 'asc' } }),
  ]);
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Copilota';

  const ore = libro.addWorksheet('Ore', { views: [{ state: 'frozen', ySplit: 1 }] });
  ore.columns = COLONNE.map((c) => ({ header: c.titolo, key: c.chiave, width: c.chiave === 'note' ? 40 : 20, style: { numFmt: '@' } }));
  stileIntestazione(ore.getRow(1));
  // Riga di esempio: ultimo giorno feriale prima di oggi, primo dipendente e progetto.
  let giorno = aggiungiGiorni(oggi, -1);
  while (isFineSettimana(giorno)) giorno = aggiungiGiorni(giorno, -1);
  const esempio = ore.addRow({
    matricola: dipendenti[0]?.matricola ?? '0001',
    data: formattaData(giorno),
    oraInizio: '08:00',
    oraFine: '12:30',
    codiceProgetto: progetti[0]?.codice ?? 'PRG-001',
    note: `${MARCATORE_ESEMPIO} - viene ignorata, sostituiscila con le ore vere`,
  });
  esempio.font = { italic: true, color: { argb: 'FF6B7280' } };
  // Menu a tendina su matricola e codice progetto (righe 2-1000), dagli elenchi validi.
  for (let r = 2; r <= 1000; r++) {
    ore.getCell(`A${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Dipendenti!$A$2:$A$${Math.max(2, dipendenti.length + 1)}`] };
    ore.getCell(`E${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Progetti!$A$2:$A$${Math.max(2, progetti.length + 1)}`] };
  }

  const istruzioni = libro.addWorksheet('Istruzioni');
  istruzioni.columns = [{ width: 24 }, { width: 90 }];
  istruzioni.addRow(['Copilota — import delle ore']).font = { bold: true, size: 14 };
  istruzioni.addRow([]);
  const righeIstruzioni: [string, string][] = [
    ['Foglio', 'Compila il foglio "Ore": una riga per ogni fascia oraria lavorata.'],
    ['Matricola', 'Matricola del dipendente (vedi foglio "Dipendenti"). Obbligatoria.'],
    ['Data', 'Giorno lavorato, formato gg/mm/aaaa (es. 05/11/2026). Non sono ammessi giorni futuri.'],
    ['Ora inizio / fine', 'Formato HH:MM a 24 ore (es. 08:00, 17:30). La fine deve essere dopo l\'inizio; una fascia non attraversa la mezzanotte.'],
    ['Codice progetto', 'Codice del progetto (vedi foglio "Progetti"). Obbligatorio.'],
    ['Note', 'Facoltative, massimo 500 caratteri.'],
    ['Più fasce', 'Per lo stesso giorno si possono inserire più righe (es. mattina e pomeriggio), purché non si sovrappongano fra loro né con ore già registrate.'],
    ['Riga di esempio', `La riga con la nota "${MARCATORE_ESEMPIO}" viene ignorata: puoi cancellarla o sovrascriverla.`],
    ['Import', 'In Copilota: Importa → scegli il file → controlla l\'anteprima. Se una riga ha errori il file viene rifiutato e si vedono le righe da correggere; altrimenti si conferma e si importa tutto.'],
  ];
  for (const r of righeIstruzioni) {
    const riga = istruzioni.addRow(r);
    riga.getCell(1).font = { bold: true };
    riga.alignment = { wrapText: true, vertical: 'top' };
  }

  const fogliElenco: [string, string[], string[][]][] = [
    ['Dipendenti', ['Matricola', 'Cognome', 'Nome'], dipendenti.map((d) => [d.matricola, d.cognome, d.nome])],
    ['Progetti', ['Codice progetto', 'Nome', 'Cliente'], progetti.map((p) => [p.codice, p.nome, p.cliente ?? ''])],
  ];
  for (const [nome, intestazioni, righe] of fogliElenco) {
    const foglio = libro.addWorksheet(nome);
    foglio.columns = intestazioni.map((h) => ({ header: h, width: 24, style: { numFmt: '@' } }));
    stileIntestazione(foglio.getRow(1));
    foglio.addRows(righe);
  }
  return libro;
}

/**
 * Legge il file e controlla ogni riga: forma dei dati, esistenza di dipendente e progetto,
 * regole di contesto (servizi/regole-ore.ts), sovrapposizioni con le ore già registrate e
 * con le altre righe del file.
 */
export async function analizzaFile(prisma: PrismaClient, dati: Buffer, oggi: string): Promise<EsitoAnalisi> {
  const vuoto = (erroreFile: string): EsitoAnalisi => ({
    righe: [],
    riepilogo: { totali: 0, valide: 0, conErrori: 0, ignorate: 0, minuti: 0 },
    importabile: false,
    erroreFile,
  });

  let libro: ExcelJS.Workbook;
  try {
    libro = await caricaLibro(dati);
  } catch (e) {
    return vuoto((e as Error).message);
  }
  const foglio = libro.getWorksheet('Ore') ?? libro.worksheets[0];
  if (!foglio) return vuoto('Il file non contiene fogli');

  // Riconosce le colonne dall'intestazione.
  const posizioni = new Map<ChiaveColonna, number>();
  foglio.getRow(1).eachCell((cella, numero) => {
    const nome = normalizza(testoCella(cella));
    const colonna = COLONNE.find((c) => (c.alias as readonly string[]).includes(nome));
    if (colonna && !posizioni.has(colonna.chiave)) posizioni.set(colonna.chiave, numero);
  });
  const mancanti = COLONNE.filter((c) => c.chiave !== 'note' && !posizioni.has(c.chiave)).map((c) => c.titolo);
  if (mancanti.length) return vuoto(`Mancano le colonne: ${mancanti.join(', ')}. Usa il modello scaricabile da Copilota.`);

  // Prima passata: lettura e controlli di forma.
  const righe: RigaImport[] = [];
  const cella = (r: ExcelJS.Row, chiave: ChiaveColonna) => r.getCell(posizioni.get(chiave) ?? 999);
  for (let n = 2; n <= foglio.rowCount; n++) {
    const r = foglio.getRow(n);
    const matricola = testoCella(cella(r, 'matricola'));
    const codiceProgetto = testoCella(cella(r, 'codiceProgetto')).toUpperCase();
    const testoData = testoCella(cella(r, 'data'));
    const testoInizio = testoCella(cella(r, 'oraInizio'));
    const testoFine = testoCella(cella(r, 'oraFine'));
    const note = testoCella(cella(r, 'note')) || null;
    if (!matricola && !codiceProgetto && !testoData && !testoInizio && !testoFine && !note) continue; // riga vuota
    if (righe.length >= MAX_RIGHE) return vuoto(`Troppe righe: massimo ${MAX_RIGHE} per file`);

    const riga: RigaImport = {
      riga: n, matricola, codiceProgetto, note,
      data: dataCella(cella(r, 'data')),
      oraInizio: orarioCella(cella(r, 'oraInizio')),
      oraFine: orarioCella(cella(r, 'oraFine')),
      dipendente: null, progetto: null, minuti: null, errori: [],
    };
    if (note?.toUpperCase().startsWith(MARCATORE_ESEMPIO)) {
      riga.ignorata = 'Riga di esempio del modello';
      righe.push(riga);
      continue;
    }
    if (!matricola) riga.errori.push('Matricola mancante');
    if (!codiceProgetto) riga.errori.push('Codice progetto mancante');
    if (!testoData) riga.errori.push('Data mancante');
    else if (!riga.data) riga.errori.push(`Data non valida: "${testoData}" (usa gg/mm/aaaa)`);
    else if (riga.data < DATA_MINIMA) riga.errori.push(MESSAGGIO_DATA_MINIMA);
    if (!testoInizio) riga.errori.push('Ora inizio mancante');
    else if (!riga.oraInizio) riga.errori.push(`Ora inizio non valida: "${testoInizio}" (usa HH:MM)`);
    if (!testoFine) riga.errori.push('Ora fine mancante');
    else if (!riga.oraFine) riga.errori.push(`Ora fine non valida: "${testoFine}" (usa HH:MM)`);
    if (riga.oraInizio && riga.oraFine) {
      if (riga.oraFine <= riga.oraInizio) riga.errori.push("L'ora di fine deve essere dopo l'ora di inizio");
      else riga.minuti = durataMinuti(riga.oraInizio, riga.oraFine);
    }
    if (note && note.length > 500) riga.errori.push('Note troppo lunghe (massimo 500 caratteri)');
    righe.push(riga);
  }
  const daControllare = righe.filter((r) => !r.ignorata);
  if (!daControllare.length) {
    const esito = vuoto(righe.length ? 'Il file contiene solo la riga di esempio: aggiungi le ore da importare' : 'Il file non contiene ore da importare');
    return { ...esito, righe, riepilogo: { ...esito.riepilogo, totali: righe.length, ignorate: righe.length } };
  }

  // Seconda passata: dipendenti e progetti per matricola/codice, regole e sovrapposizioni.
  // Giorno 26: il dipendente si riconosce dal NUMERO di matricola (unico fra tutti), così
  // valgono anche i file vecchi con "0004" o con la sigla del contratto di prima ("DET-0004"
  // per chi ora è IND-0004). Le matricole senza numero si confrontano com'erano.
  const [tutti, progetti] = await Promise.all([
    prisma.dipendente.findMany(),
    prisma.progetto.findMany({ where: { codice: { in: [...new Set(daControllare.map((r) => r.codiceProgetto))] } } }),
  ]);
  const perNumero = new Map(tutti.flatMap((d) => (numeroMatricola(d.matricola) !== null ? [[numeroMatricola(d.matricola)!, d] as const] : [])));
  const perTesto = new Map(tutti.map((d) => [d.matricola.toUpperCase(), d]));
  const trova = (matricola: string) => {
    const numero = numeroMatricola(matricola);
    return (numero !== null ? perNumero.get(numero) : undefined) ?? perTesto.get(matricola.trim().toUpperCase());
  };
  for (const r of daControllare) {
    const dip = trova(r.matricola);
    // Da qui la riga usa la matricola attuale: "0004" e "IND-0004" nello stesso file sono la stessa persona.
    if (dip) r.matricola = dip.matricola;
  }
  const dipendenti = tutti.filter((d) => daControllare.some((r) => r.matricola === d.matricola));
  const perMatricola = new Map(dipendenti.map((d) => [d.matricola, d]));
  const perCodice = new Map(progetti.map((p) => [p.codice, p]));
  const date = daControllare.map((r) => r.data).filter((d): d is string => !!d).sort();
  const contesto = date.length
    ? await caricaContestoOre(prisma, { dipendenteIds: dipendenti.map((d) => d.id), da: date[0], a: date[date.length - 1], oggi })
    : null;
  const esistenti = date.length
    ? await prisma.registrazioneOraria.findMany({
        where: { dipendenteId: { in: dipendenti.map((d) => d.id) }, data: { gte: date[0], lte: date[date.length - 1] } },
        include: { progetto: { select: { codice: true } } },
      })
    : [];

  for (const r of daControllare) {
    const dip = perMatricola.get(r.matricola);
    const prog = perCodice.get(r.codiceProgetto);
    if (r.matricola && !dip) r.errori.push(`Dipendente inesistente: matricola "${r.matricola}"`);
    if (r.codiceProgetto && !prog) r.errori.push(`Progetto inesistente: codice "${r.codiceProgetto}"`);
    if (dip) {
      r.dipendente = `${dip.cognome} ${dip.nome}`;
      r.dipendenteId = dip.id;
    }
    if (prog) {
      r.progetto = prog.nome;
      r.progettoId = prog.id;
    }
    if (!dip || !prog || !r.data || !contesto) continue;
    for (const e of erroriRegole(contesto, { dipendenteId: dip.id, data: r.data, progettoId: prog.id })) r.errori.push(e.messaggio);
    if (r.oraInizio && r.oraFine && r.minuti) {
      const fascia = { oraInizio: r.oraInizio, oraFine: r.oraFine };
      const giaInDb = esistenti.find((e) => e.dipendenteId === dip.id && e.data === r.data && siSovrappongono(fascia, e));
      if (giaInDb) {
        r.errori.push(`Si sovrappone alle ore già registrate ${giaInDb.oraInizio}-${giaInDb.oraFine} (${giaInDb.progetto.codice}) del ${formattaData(r.data)}`);
      }
      const nelFile = daControllare.find(
        (altra) => altra !== r && altra.riga < r.riga && altra.matricola === r.matricola && altra.data === r.data && altra.oraInizio && altra.oraFine && altra.minuti && siSovrappongono(fascia, { oraInizio: altra.oraInizio, oraFine: altra.oraFine }),
      );
      if (nelFile) r.errori.push(`Si sovrappone alla riga ${nelFile.riga} del file (${nelFile.oraInizio}-${nelFile.oraFine})`);

      // Ore massime giornaliere del progetto: ore già nel database + righe precedenti del
      // file per lo stesso dipendente, giorno e progetto + questa riga.
      if (prog.maxMinutiGiorno != null) {
        const giaInDbMinuti = esistenti
          .filter((e) => e.dipendenteId === dip.id && e.data === r.data && e.progettoId === prog.id)
          .reduce((s, e) => s + durataMinuti(e.oraInizio, e.oraFine), 0);
        const precedentiNelFile = daControllare
          .filter((x) => x.riga < r.riga && x.matricola === r.matricola && x.data === r.data && x.codiceProgetto === r.codiceProgetto && x.minuti)
          .reduce((s, x) => s + (x.minuti ?? 0), 0);
        const totale = giaInDbMinuti + precedentiNelFile + r.minuti;
        if (totale > prog.maxMinutiGiorno) r.errori.push(messaggioMassimo(prog.codice, totale, prog.maxMinutiGiorno));
      }
    }
  }

  const conErrori = daControllare.filter((r) => r.errori.length).length;
  return {
    righe,
    riepilogo: {
      totali: righe.length,
      valide: daControllare.length - conErrori,
      conErrori,
      ignorate: righe.length - daControllare.length,
      minuti: daControllare.reduce((s, r) => s + (r.errori.length ? 0 : (r.minuti ?? 0)), 0),
    },
    importabile: conErrori === 0,
  };
}
