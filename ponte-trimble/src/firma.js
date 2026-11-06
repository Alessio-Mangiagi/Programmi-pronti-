// "><(((º> sabusabu <º)))><"
// PDF firmati digitalmente in busta .p7m (CAdES), richiesta del 06/11/2026: un PCQ o un computo firmato dal
// direttore lavori arriva spesso così, da upload o da SkyTower.
//
// Il lavoro vero lo fa il motore comune della suite (shared/firma, CONTRATTI §10): apre la busta, tira fuori il
// PDF e verifica le firme (catena fino agli enti qualificati eIDAS, revoca, marca temporale). Qui:
//   - eBustaFirmata: riconoscimento senza processi (estensione .p7m o contenuto), per l'upload e per SkyTower;
//   - apriBusta: busta -> PDF + sintesi della firma da salvare nel lavoro (stato.json); errori già scritti per
//     chi usa la pagina. La pipeline la chiama nel passo "firma", prima dell'estrazione, così anche
//     "Rielabora" rifà la verifica.
// Il client vero è in dipendenzeFirma: i test lo sostituiscono con uno finto, come per SkyTower.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

export const dipendenzeFirma = {
  // stesso percorso da src/: ponte-trimble/src -> ../../shared
  client: require('../../shared/firma/firma.js'),
};

export function eBustaFirmata(buffer, nome) {
  return dipendenzeFirma.client.eBustaFirmata(buffer, nome);
}

/** "offerta.pdf.p7m" -> "offerta.pdf": il nome che si usa per gli artefatti. */
export function nomeSenzaP7m(nome) {
  let n = path.basename(String(nome || 'documento.pdf'));
  while (/\.p7m$/i.test(n)) n = n.slice(0, -4);
  return n || 'documento.pdf';
}

/** Quello che resta nel lavoro: esito, riga per la UI e i firmatari, senza i dettagli tecnici del motore. */
export function sintesiFirma(rapporto) {
  return {
    esito: rapporto.esito,
    riepilogo: rapporto.riepilogo,
    livelli: rapporto.livelli,
    firme: (rapporto.firme || []).map((f) => ({
      firmatario: f.firmatario,
      codiceFiscale: f.codice_fiscale ?? null,
      ente: f.ente_certificatore ?? null,
      tipo: f.tipo ?? null,
      esito: f.esito,
      motivi: f.motivi || [],
      // la data che vale: marca temporale se valida, altrimenti quella dichiarata dal firmatario
      data: (f.marca_temporale?.valida ? f.marca_temporale.data : null) ?? f.data_firma_dichiarata ?? null,
      marcaTemporale: Boolean(f.marca_temporale?.valida),
    })),
    verificataIl: new Date().toISOString(),
  };
}

/**
 * Apre la busta e verifica le firme. Una firma non valida non ferma il lavoro: resta scritta in `firma`.
 * @returns {Promise<{pdf: Buffer, nomePdf: string, firma: object}>}
 * @throws Error con un messaggio per l'utente (motore non installato, busta rotta, contenuto non PDF)
 */
export async function apriBusta(buffer, nome, { rete = true } = {}) {
  let aperta;
  try {
    aperta = await dipendenzeFirma.client.apri(buffer, nome, { rete });
  } catch (e) {
    if (e.code === 'FIRMA_NON_INSTALLATA') {
      throw new Error('componente firma digitale non installato: lanciare shared\\firma\\installa.bat, poi "Rielabora"');
    }
    if (e.code === 'BUSTA_ILLEGGIBILE') throw new Error('file firmato illeggibile: ' + e.message);
    throw new Error('verifica della firma non riuscita: ' + e.message);
  }
  const pdf = aperta.contenuto;
  if (!(/\.pdf$/i.test(aperta.nomeContenuto || '') || pdf.subarray(0, 5).toString('latin1') === '%PDF-')) {
    throw new Error('la busta firmata contiene "' + aperta.nomeContenuto + '": serve un PDF');
  }
  return { pdf, nomePdf: aperta.nomeContenuto || nomeSenzaP7m(nome), firma: sintesiFirma(aperta.rapporto) };
}
