// "><(((º> sabusabu <º)))><"
/**
 * Andamento dell'avanzamento di un progetto (Giorno 17, risposta 2c: "% avanzamento a
 * ogni caricamento, con l'andamento nella pagina del progetto").
 *
 * Una sola serie: la percentuale dichiarata in ogni documento, nel tempo. SVG fatto a mano
 * (nessuna libreria di grafici) seguendo le regole della skill dataviz:
 * - linea da 2px con giunzioni arrotondate, punti da 9px con anello bianco da 2px;
 * - asse Y fisso 0-100% con tacche tonde e griglia sottile grigia, continua;
 * - una sola etichetta diretta, sull'ultimo punto; il resto lo dice il suggerimento;
 * - suggerimento al passaggio del mouse o col tasto Tab su ogni punto (area di presa più
 *   grande del punto); tabella nascosta per i lettori di schermo.
 * La larghezza segue il contenitore (ResizeObserver), così il grafico riempie la sezione
 * dal telefono all'ultra wide senza deformare punti e testi.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { formattaData } from "../../comune/date";

export type PuntoAvanzamento = {
  id: number;
  data: string;
  percentuale: number;
  titolo: string;
  autore: string;
};

const ALTEZZA = 180;
const MARGINE = { sopra: 14, destra: 44, sotto: 26, sinistra: 40 };
const TACCHE = [0, 25, 50, 75, 100];
const COLORE_SERIE = "#0c4577"; // blu del marchio: una sola serie, nessuna legenda (la nomina il titolo)
const GRIGLIA = "#e5e7eb";
const TESTO_ASSI = "#6b7280";

/** Giorni dal 1970 di una data "AAAA-MM-GG" (asse X proporzionale al tempo). */
const giorno = (d: string) =>
  Date.UTC(
    Number(d.slice(0, 4)),
    Number(d.slice(5, 7)) - 1,
    Number(d.slice(8, 10)),
  ) / 86_400_000;

export function GraficoAvanzamento({ punti }: { punti: PuntoAvanzamento[] }) {
  const contenitore = useRef<HTMLDivElement>(null);
  const [larghezza, setLarghezza] = useState(600);
  const [attivo, setAttivo] = useState<number | null>(null);
  const conDati = punti.length > 0;

  useLayoutEffect(() => {
    const el = contenitore.current;
    if (!el) return;
    const misura = (w: number) => setLarghezza(Math.max(220, Math.round(w)));
    // Prima misura subito, prima che il browser disegni: niente grafico largo 600px per un
    // istante sul telefono (farebbe scorrere la pagina in orizzontale).
    misura(el.clientWidth);
    const osserva = new ResizeObserver(([voce]) =>
      misura(voce.contentRect.width),
    );
    osserva.observe(el);
    return () => osserva.disconnect();
    // Si riaggancia quando si passa da "nessun dato" al grafico (cambia l'elemento misurato).
  }, [conDati]);

  // Il contenitore c'è sempre (anche senza dati), così ResizeObserver lo misura da subito.
  if (!punti.length) {
    return (
      <div ref={contenitore} className="w-full">
        <p className="py-6 text-center text-sm text-gray-500">
          Nessuna percentuale dichiarata: l'andamento comparirà qui quando la
          documentazione indica l'avanzamento.
        </p>
      </div>
    );
  }

  // In ordine di data; a parità di giorno conta l'ordine di caricamento (id crescente).
  const ordinati = [...punti].sort(
    (a, b) => a.data.localeCompare(b.data) || a.id - b.id,
  );
  const primo = giorno(ordinati[0].data);
  const ultimo = giorno(ordinati[ordinati.length - 1].data);
  const ampiezza = Math.max(ultimo - primo, 1);
  const larghezzaUtile = larghezza - MARGINE.sinistra - MARGINE.destra;
  const altezzaUtile = ALTEZZA - MARGINE.sopra - MARGINE.sotto;
  // Un solo giorno: punti al centro; altrimenti proporzionali alla data.
  const x = (p: PuntoAvanzamento) =>
    MARGINE.sinistra +
    (ultimo === primo
      ? larghezzaUtile / 2
      : ((giorno(p.data) - primo) / ampiezza) * larghezzaUtile);
  const y = (v: number) =>
    MARGINE.sopra + altezzaUtile - (v / 100) * altezzaUtile;
  const percorso = ordinati
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${x(p).toFixed(1)},${y(p.percentuale).toFixed(1)}`,
    )
    .join(" ");
  const finale = ordinati[ordinati.length - 1];
  const puntoAttivo = ordinati.find((p) => p.id === attivo);

  return (
    <div ref={contenitore} className="relative w-full">
      <svg
        width={larghezza}
        height={ALTEZZA}
        role="img"
        aria-label={`Avanzamento dichiarato: ultimo ${finale.percentuale}% il ${formattaData(finale.data)}`}
        className="block"
      >
        {/* Griglia e asse Y: tacche 0-100%, sottili e grigie */}
        {TACCHE.map((t) => (
          <g key={t}>
            <line
              x1={MARGINE.sinistra}
              x2={larghezza - MARGINE.destra}
              y1={y(t)}
              y2={y(t)}
              stroke={GRIGLIA}
              strokeWidth={1}
            />
            <text
              x={MARGINE.sinistra - 6}
              y={y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={11}
              fill={TESTO_ASSI}
              className="cifre"
            >
              {t}%
            </text>
          </g>
        ))}
        {/* Asse X: prima e ultima data (le altre nel suggerimento) */}
        <text
          x={x(ordinati[0])}
          y={ALTEZZA - 6}
          textAnchor={ultimo === primo ? "middle" : "start"}
          fontSize={11}
          fill={TESTO_ASSI}
          className="cifre"
        >
          {formattaData(ordinati[0].data)}
        </text>
        {ultimo !== primo && (
          <text
            x={x(finale)}
            y={ALTEZZA - 6}
            textAnchor="end"
            fontSize={11}
            fill={TESTO_ASSI}
            className="cifre"
          >
            {formattaData(finale.data)}
          </text>
        )}
        <path
          d={percorso}
          fill="none"
          stroke={COLORE_SERIE}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {ordinati.map((p) => (
          <g key={p.id}>
            <circle
              cx={x(p)}
              cy={y(p.percentuale)}
              r={4.5}
              fill={COLORE_SERIE}
              stroke="#ffffff"
              strokeWidth={2}
            />
            {/* Area di presa più grande del punto, anche da tastiera */}
            <circle
              cx={x(p)}
              cy={y(p.percentuale)}
              r={12}
              fill="transparent"
              tabIndex={0}
              aria-label={`${formattaData(p.data)}: ${p.percentuale}% — ${p.titolo} (${p.autore})`}
              onMouseEnter={() => setAttivo(p.id)}
              onMouseLeave={() => setAttivo(null)}
              onFocus={() => setAttivo(p.id)}
              onBlur={() => setAttivo(null)}
              className="cursor-pointer focus:outline-none"
            />
          </g>
        ))}
        {/* Etichetta diretta solo sull'ultimo valore, nel colore del testo (non della serie) */}
        <text
          x={x(finale) + 8}
          y={y(finale.percentuale)}
          dominantBaseline="middle"
          fontSize={12}
          fontWeight={600}
          fill="#212326"
          className="cifre"
        >
          {finale.percentuale}%
        </text>
      </svg>
      {puntoAttivo && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-60 -translate-x-1/2 -translate-y-full rounded border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-[0_8px_24px_rgba(12,69,119,0.14)]"
          style={{
            left: Math.min(Math.max(x(puntoAttivo), 90), larghezza - 90),
            top: y(puntoAttivo.percentuale) - 10,
          }}
        >
          <div className="cifre font-semibold text-testo-forte">
            {puntoAttivo.percentuale}% · {formattaData(puntoAttivo.data)}
          </div>
          <div className="truncate text-gray-700">{puntoAttivo.titolo}</div>
          <div className="truncate text-gray-500">{puntoAttivo.autore}</div>
        </div>
      )}
      {/* Gli stessi dati in tabella per i lettori di schermo. sr-only sta sul <div>: una
          <table> non rispetta la larghezza di 1px e farebbe scorrere la pagina sul telefono. */}
      <div className="sr-only">
        <table>
          <caption>Avanzamento dichiarato nel tempo</caption>
          <thead>
            <tr>
              <th>Data</th>
              <th>Percentuale</th>
              <th>Documento</th>
              <th>Autore</th>
            </tr>
          </thead>
          <tbody>
            {ordinati.map((p) => (
              <tr key={p.id}>
                <td>{formattaData(p.data)}</td>
                <td>{p.percentuale}%</td>
                <td>{p.titolo}</td>
                <td>{p.autore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
