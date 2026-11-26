// "><(((º> sabusabu <º)))><"
/**
 * "Cancella tutti i dati" del proprietario (25/11/2026, risposta 3a): riporta Logbook come
 * appena installato.
 *
 * Restano:
 * - l'account del proprietario, con la sua password e le sue sessioni (resta collegato);
 * - le impostazioni, cioè il collegamento a SkyTower;
 * - le festività NAZIONALI. Quelle dell'anno in corso e del successivo, se mancano, si
 *   ricaricano.
 *
 * Va via tutto il resto:
 * - dipendenti e progetti, con ore, assenze, attestati, documenti, note, assegnazioni e
 *   segnalazioni;
 * - mansioni, festività locali e aziendali;
 * - tutti gli altri account;
 * - i file caricati, anche dal disco.
 *
 * Tutto in una transazione: o si cancella tutto o non si cancella niente. I file sul disco si
 * tolgono solo dopo, a transazione riuscita, e solo quelli elencati nel database (mai altro
 * dalla cartella). L'ordine rispetta i vincoli del database: prima le righe che puntano ad
 * altre (ore, assenze, documenti…), poi dipendenti, progetti e account.
 */
import type { PrismaClient } from '../../generated/prisma/client';
import { eliminaContenuto } from './archivio-file';
import { aggiungiFestivitaNazionali } from './festivita';

export type EsitoCancellazione = {
  dipendenti: number;
  progetti: number;
  registrazioni: number;
  assenze: number;
  account: number;
  file: number;
};

export async function cancellaTuttiIDati(
  prisma: PrismaClient,
  cartellaDocumenti: string,
  proprietarioId: number,
  oggi: string,
): Promise<EsitoCancellazione> {
  const file = await prisma.fileCaricato.findMany({ select: { nomeDisco: true } });

  const esito = await prisma.$transaction(async (tx) => {
    // Il proprietario non resta legato a una scheda dipendente che sta per sparire.
    await tx.utente.update({ where: { id: proprietarioId }, data: { dipendenteId: null } });
    const registrazioni = (await tx.registrazioneOraria.deleteMany()).count;
    const assenze = (await tx.assenza.deleteMany()).count;
    await tx.segnalazione.deleteMany();
    await tx.meseChiuso.deleteMany();
    await tx.quotaAssenze.deleteMany();
    // Il registro delle attività NON si cancella: deve restare traccia anche di questa operazione.
    await tx.attestato.deleteMany();
    await tx.documentoDipendente.deleteMany();
    await tx.documentoProgetto.deleteMany();
    await tx.notaProgetto.deleteMany();
    await tx.assegnazioneProgetto.deleteMany();
    await tx.fileCaricato.deleteMany();
    // Gli altri account (le loro sessioni se ne vanno con loro, onDelete: Cascade).
    const account = (await tx.utente.deleteMany({ where: { id: { not: proprietarioId } } })).count;
    const dipendenti = (await tx.dipendente.deleteMany()).count;
    const progetti = (await tx.progetto.deleteMany()).count;
    await tx.mansione.deleteMany();
    await tx.festivita.deleteMany({ where: { tipo: { not: 'NAZIONALE' } } });
    return { dipendenti, progetti, registrazioni, assenze, account, file: file.length };
  });

  for (const f of file) await eliminaContenuto(prisma, cartellaDocumenti, f.nomeDisco);
  const anno = Number(oggi.slice(0, 4));
  for (const a of [anno, anno + 1]) await aggiungiFestivitaNazionali(prisma, a);
  return esito;
}
