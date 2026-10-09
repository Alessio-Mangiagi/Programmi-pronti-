import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

/**
 * Grafico dei risultati (2 colonne: etichetta + valore). Componente SEPARATO e
 * caricato lazy da ResultView: `recharts` pesa centinaia di KB e serve solo
 * quando c'è un risultato graficabile — fuori dal bundle iniziale.
 */
export default function ResultChart({ data, temporal }: {
  data: Array<{ name: string; val: number }>
  temporal: boolean
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {temporal ? (
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e7ec" />
          <XAxis dataKey="name" stroke="#626d78" fontSize={11} />
          <YAxis stroke="#626d78" fontSize={11} />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e7ec', borderRadius: 8, fontSize: 12 }} />
          <Line type="monotone" dataKey="val" stroke="#0c4577" strokeWidth={2} dot={false} />
        </LineChart>
      ) : (
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e7ec" />
          <XAxis dataKey="name" stroke="#626d78" fontSize={11} />
          <YAxis stroke="#626d78" fontSize={11} />
          <Tooltip contentStyle={{ background: '#fff', border: '1px solid #e2e7ec', borderRadius: 8, fontSize: 12 }} cursor={{ fill: '#ecf2f8' }} />
          <Bar dataKey="val" fill="#0c4577" radius={[4, 4, 0, 0]} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}
