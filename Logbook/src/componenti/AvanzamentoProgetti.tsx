// "><(((º> sabusabu <º)))><"
/**
 * Riquadro "Avanzamento dei progetti" della dashboard di HR (Giorno 29, dal piano: "grafici
 * di avanzamento in dashboard"; dati da GET /api/dashboard → avanzamentoProgetti).
 *
 * Una riga per progetto non chiuso, cliccabile verso la pagina del progetto:
 * - nome e codice (con il quadratino del colore del progetto, lo stesso del calendario);
 * - andamento nel tempo come piccolo grafico a linea (sparkline): asse 0-100% fisso per
 *   tutte le righe, così le pendenze si confrontano a colpo d'occhio;
 * - ultima percentuale dichiarata in cifre e una barra 0-100 dello stesso valore.
 *
 * Regole della skill dataviz: una serie per riga (la nomina la riga, niente legenda), colore
 * dell'identità del progetto, linea da 2px con estremi arrotondati, ultimo punto marcato
 * con anello bianco da 2px, testi nei colori del testo e mai in quello della serie;
 * suggerimento su ogni punto (area di presa più grande del punto) e descrizione per i
 * lettori di schermo. I progetti senza percentuali dichiarate lo dicono, senza grafico.
 */
import { Link } from 'react-router-dom';
import { formattaData } from '../../comune/date';
import { coloreProgetto } from '../colori';
import { Etichetta } from './ui';

export type AvanzamentoProgetto = {
  id: number;
  codice: string;
  nome: string;
  colore: string | null;
  stato: 'ATTIVO' | 'SOSPESO' | 'CHIUSO';
  punti: { data: string; percentuale: number }[];
};

const LARGHEZZA = 132;
const ALTEZZA = 30;
const BORDO = 4; // spazio per il punto finale con il suo anello

/** Giorni dal 1970 di una data "AAAA-MM-GG": l'asse X è proporzionale al tempo. */
const giorno = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / 86_400_000;

function Sparkline({ p }: { p: AvanzamentoProgetto }) {
  const colore = coloreProgetto(p);
  const [primo, ultimo] = [p.punti[0], p.punti[p.punti.length - 1]];
  const arco = Math.max(1, giorno(ultimo.data) - giorno(primo.data));
  // Un solo punto: al centro. Più punti: dal primo all'ultimo giorno dichiarato.
  const x = (d: string) => (p.punti.length === 1 ? LARGHEZZA / 2 : BORDO + ((giorno(d) - giorno(primo.data)) / arco) * (LARGHEZZA - 2 * BORDO));
  const y = (v: number) => BORDO + (1 - v / 100) * (ALTEZZA - 2 * BORDO);
  const descrizione =
    p.punti.length === 1
      ? `${p.codice}: ${ultimo.percentuale}% il ${formattaData(ultimo.data)}`
      : `${p.codice}: da ${primo.percentuale}% il ${formattaData(primo.data)} a ${ultimo.percentuale}% il ${formattaData(ultimo.data)}, ${p.punti.length} dichiarazioni`;
  return (
    <svg width={LARGHEZZA} height={ALTEZZA} viewBox={`0 0 ${LARGHEZZA} ${ALTEZZA}`} role="img" aria-label={descrizione} className="shrink-0 overflow-visible">
      {/* Riferimenti 0% e 100%: sottili e grigi, sotto la serie. */}
      <line x1={0} x2={LARGHEZZA} y1={y(0)} y2={y(0)} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={0} x2={LARGHEZZA} y1={y(100)} y2={y(100)} stroke="#f2f3f5" strokeWidth={1} />
      {p.punti.length > 1 && (
        <polyline points={p.punti.map((q) => `${x(q.data)},${y(q.percentuale)}`).join(' ')} fill="none" stroke={colore} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {p.punti.map((q, i) => (
        <g key={q.data}>
          {/* Area di presa più grande del punto: il suggerimento compare anche sfiorandolo. */}
          <circle cx={x(q.data)} cy={y(q.percentuale)} r={7} fill="transparent">
            <title>{`${formattaData(q.data)}: ${q.percentuale}%`}</title>
          </circle>
          {i === p.punti.length - 1 && <circle cx={x(q.data)} cy={y(q.percentuale)} r={4} fill={colore} stroke="#ffffff" strokeWidth={2} pointerEvents="none" />}
        </g>
      ))}
    </svg>
  );
}

export function AvanzamentoProgetti({ progetti }: { progetti: AvanzamentoProgetto[] }) {
  return (
    <ul className="divide-y divide-gray-100 text-sm">
      {progetti.map((p) => {
        const ultimo = p.punti[p.punti.length - 1];
        return (
          <li key={p.id}>
            <Link
              to={`/progetti/${p.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded px-1 py-2 transition-colors hover:bg-ghiaccio focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marchio-chiaro"
              title={`Apri il progetto ${p.nome}`}
            >
              <span className="flex min-w-0 flex-[1_1_12rem] items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: coloreProgetto(p) }} />
                <span className="min-w-0 truncate">
                  <b className="font-semibold text-testo-forte">{p.codice}</b> <span className="text-gray-600">{p.nome}</span>
                </span>
                {p.stato === 'SOSPESO' && <Etichetta colore="giallo">Sospeso</Etichetta>}
              </span>
              {ultimo ? (
                <>
                  <Sparkline p={p} />
                  {/* Ultima percentuale con la sua barra 0-100 e, sotto, il giorno della dichiarazione. */}
                  <span className="flex w-40 shrink-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="cifre w-10 text-right text-base font-semibold text-testo-forte">{ultimo.percentuale}%</span>
                      {/* Estremo arrotondato, binario grigio chiaro. */}
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                        <span className="block h-full rounded-full" style={{ width: `${ultimo.percentuale}%`, backgroundColor: coloreProgetto(p) }} />
                      </span>
                    </span>
                    <span className="cifre pl-12 text-xs text-gray-500">al {formattaData(ultimo.data)}</span>
                  </span>
                </>
              ) : (
                <span className="text-xs text-gray-500">nessun avanzamento dichiarato</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
