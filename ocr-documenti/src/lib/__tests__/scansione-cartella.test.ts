// "><(((º> sabusabu <º)))><"
/**
 * Test delle regole della scansione di una cartella (src/lib/scansione-cartella.ts):
 * quando parte da sola, quale sarà il prossimo avvio, quali file prende, come evita di
 * sovrascrivere e come scrive il registro. L'accesso alle cartelle vere (File System
 * Access API) si prova dal vivo in Chrome/Edge, non qui.
 */
import { describe, it, expect } from 'vitest'
import { IMPOSTAZIONI_INIZIALI, REGISTRO, daConsiderare, deveAvviare, nomeLibero, prossimoAvvio, rigaRegistro, type Impostazioni } from '../scansione-cartella'

const imp = (p: Partial<Impostazioni>): Impostazioni => ({ ...IMPOSTAZIONI_INIZIALI, ...p })
// mercoledì 4 novembre 2026, ora locale
const mer = (h: number, m = 0) => new Date(2026, 10, 4, h, m)

describe('deveAvviare', () => {
  it('a mano non parte mai', () => {
    expect(deveAvviare(imp({ avvio: 'mano' }), mer(20), 0)).toBe(false)
  })

  it('a orario: parte passata l\'ora, una volta sola al giorno', () => {
    const i = imp({ avvio: 'orario', orario: '20:00', giorni: [3] })
    expect(deveAvviare(i, mer(19, 59), 0)).toBe(false)
    expect(deveAvviare(i, mer(20, 0), 0)).toBe(true)
    // pagina riaperta alle 22: la scansione persa delle 20 parte adesso
    expect(deveAvviare(i, mer(22), 0)).toBe(true)
    // già fatta alle 20:01: alle 22 non riparte
    expect(deveAvviare({ ...i, ultimaScansione: mer(20, 1).getTime() }, mer(22), 0)).toBe(false)
    // una scansione a mano alle 19 non toglie quella delle 20
    expect(deveAvviare({ ...i, ultimaScansione: mer(19).getTime() }, mer(20, 5), 0)).toBe(true)
  })

  it('a orario: solo nei giorni scelti e con un orario valido', () => {
    expect(deveAvviare(imp({ avvio: 'orario', orario: '08:00', giorni: [1, 2] }), mer(9), 0)).toBe(false)
    expect(deveAvviare(imp({ avvio: 'orario', orario: '25:00', giorni: [3] }), mer(23), 0)).toBe(false)
  })

  it('all\'arrivo: ogni N minuti dall\'ultimo controllo', () => {
    const i = imp({ avvio: 'arrivo', ogniMinuti: 5 })
    const t = mer(10).getTime()
    expect(deveAvviare(i, new Date(t + 4 * 60_000), t)).toBe(false)
    expect(deveAvviare(i, new Date(t + 5 * 60_000), t)).toBe(true)
  })
})

describe('prossimoAvvio', () => {
  it('a orario: oggi se l\'ora deve ancora venire, altrimenti il prossimo giorno scelto', () => {
    const i = imp({ avvio: 'orario', orario: '20:00', giorni: [3, 5] })
    expect(prossimoAvvio(i, mer(10), 0)).toEqual(mer(20))
    const fatto = { ...i, ultimaScansione: mer(20, 1).getTime() }
    expect(prossimoAvvio(fatto, mer(21), 0)).toEqual(new Date(2026, 10, 6, 20, 0))   // venerdì
  })
  it('a mano: nessuno', () => {
    expect(prossimoAvvio(imp({ avvio: 'mano' }), mer(10), 0)).toBeNull()
  })
})

describe('daConsiderare', () => {
  it('prende documenti, immagini, moduli e allegati Excel', () => {
    for (const n of ['Contratto.pdf', 'bozza.DOCX', 'scan.jpg', 'modulo.txt', 'allegato.xlsx']) expect(daConsiderare(n)).toBe(true)
  })
  it('lascia i temporanei di Office, i nascosti, il registro e i tipi sconosciuti', () => {
    for (const n of ['~$Contratto.docx', '.DS_Store', REGISTRO, 'archivio.zip', 'note.msg']) expect(daConsiderare(n)).toBe(false)
  })
})

describe('nomeLibero', () => {
  it('non sovrascrive: aggiunge (2), (3)…', () => {
    expect(nomeLibero('a.pdf', new Set())).toBe('a.pdf')
    expect(nomeLibero('a.pdf', new Set(['a.pdf']))).toBe('a (2).pdf')
    expect(nomeLibero('a.pdf', new Set(['a.pdf', 'a (2).pdf']))).toBe('a (3).pdf')
    expect(nomeLibero('senza estensione', new Set(['senza estensione']))).toBe('senza estensione (2)')
  })
})

describe('rigaRegistro', () => {
  it('data e ora italiane, ";" come separatore, note su una riga e protette', () => {
    const r = rigaRegistro({ quando: mer(20, 5), file: 'Contratto; rev.pdf', esito: 'da controllare', note: 'riga 32: errore\n"x"' })
    expect(r).toBe('04/11/2026;20:05;"Contratto; rev.pdf";da controllare;;"riga 32: errore ""x"""')
  })
})
