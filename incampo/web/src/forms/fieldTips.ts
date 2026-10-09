import type { Field } from '@fieldview/form-core'
import { NON_CONFORMITY_RE } from './nonConformity'

const fmt = (n: number) => n.toLocaleString('it-IT')

/**
 * Suggerimenti di compilazione per un campo, ricavati da tipo e regole dello schema
 * (obbligatorio, limiti, opzioni…): sono quelli del tooltip in hover. Il testo di
 * aiuto scritto nel modulo (`help`) resta sotto il campo e non si ripete qui.
 */
export function fieldTips(f: Field): string[] {
  const tips: string[] = []
  if (f.required) tips.push('Obbligatorio: senza risposta il modulo non si salva.')

  switch (f.type) {
    case 'text':
    case 'textarea':
      tips.push(f.type === 'text' ? 'Risposta breve, una riga.' : 'Descrivi cosa hai visto e dove: chi legge il PDF non era in cantiere.')
      if (f.max_length) tips.push(`Massimo ${fmt(f.max_length)} caratteri.`)
      break
    case 'number': {
      tips.push(f.integer ? 'Solo numeri interi.' : 'Numero; per i decimali usa la virgola o il punto.')
      const { min, max } = f
      if (min !== undefined && max !== undefined) tips.push(`Valore fra ${fmt(min)} e ${fmt(max)}.`)
      else if (min !== undefined) tips.push(`Almeno ${fmt(min)}.`)
      else if (max !== undefined) tips.push(`Al massimo ${fmt(max)}.`)
      break
    }
    case 'checkbox':
      tips.push('Spunta per "Sì"; lasciata vuota vale "No".')
      break
    case 'select':
    case 'multiselect':
      tips.push(f.type === 'select' ? `Una sola scelta fra ${f.options.length} opzioni.` : 'Puoi scegliere più opzioni: clicca per selezionare o togliere.')
      if (f.options.some((o) => NON_CONFORMITY_RE.test(o))) tips.push('Con "Non conforme" ti verrà proposto un task per la correzione.')
      break
    case 'date':
      tips.push(f.default === 'today' ? 'Già compilata con la data di oggi: cambiala se il controllo è di un altro giorno.' : 'Scegli la data dal calendario.')
      break
    case 'photo':
      tips.push(f.multiple ? 'Puoi aggiungere più foto: una d\'insieme e una da vicino aiutano.' : 'Una sola foto: inquadra bene il dettaglio.')
      break
    case 'signature':
      tips.push('Firma con il mouse o con il dito sullo schermo; "Cancella" per rifarla prima di salvare.')
      break
    case 'geolocation':
      tips.push('"Posizione attuale" usa il GPS del dispositivo: consenti l\'accesso quando il browser lo chiede.')
      break
  }

  tips.push('Con "Commento o foto" aggiungi una nota a questa risposta.')
  return tips
}
