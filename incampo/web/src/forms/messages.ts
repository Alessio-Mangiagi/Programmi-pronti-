/** Messaggi del validatore (in inglese, identici al server) tradotti per l'utente. */
const MESSAGES: Record<string, string> = {
  required: 'Campo obbligatorio',
  'must be a string': 'Deve essere un testo',
  'must be a number': 'Deve essere un numero',
  'must be an integer': 'Deve essere un numero intero',
  'must be a boolean': 'Valore non valido',
  'not one of options': 'Scegli una delle opzioni',
  'must be a list of strings': 'Scegli tra le opzioni',
  'contains values not in options': 'Contiene opzioni non previste',
  'contains duplicates': 'Contiene duplicati',
  'must be a date YYYY-MM-DD': 'Data non valida',
  'must be a list of attachment ids': 'Foto non valide',
  'only one photo allowed': 'È ammessa una sola foto',
  'must be an attachment id': 'Firma mancante',
  'must be an object with numeric lat and lng': 'Inserisci latitudine e longitudine',
  'lat/lng out of range': 'Coordinate fuori intervallo',
  "'accuracy' must be a number": 'Precisione non valida',
  'only lat, lng, accuracy allowed': 'Posizione non valida',
  'unknown field': 'Campo non previsto dal modulo',
}

export function translateMessage(msg: string): string {
  if (MESSAGES[msg]) return MESSAGES[msg]
  const longer = msg.match(/^longer than (\d+) characters$/)
  if (longer) return `Massimo ${longer[1]} caratteri`
  const ge = msg.match(/^must be >= (.+)$/)
  if (ge) return `Minimo ${ge[1]}`
  const le = msg.match(/^must be <= (.+)$/)
  if (le) return `Massimo ${le[1]}`
  return msg
}
