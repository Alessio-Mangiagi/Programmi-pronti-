// "><(((º> sabusabu <º)))><"
// Client della firma digitale nel browser (src/lib/firma.ts): riconoscimento delle buste .p7m,
// sostituzione in coda col PDF estratto (rapporto e originale agganciati al File), errori per
// l'utente, colori del badge. Il server è finto (fetch sostituita).
import { describe, it, expect } from 'vitest'
import { apriFirmato, aspettoEsito, contenutoFirmato, firmaDi, notaFirma, originaleDi, preparaFile, registraFirma, sembraFirmato } from '../firma'

const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n')
const rapporto = { firmato: true, esito: 'valida', riepilogo: 'Firma valida: Mario Rossi (InfoCert S.p.A.), 12/03/2024', firme: [{ firmatario: 'Mario Rossi', esito: 'valida', motivi: [] }], livelli: 1 }
// testa DER di una busta SignedData: SEQUENCE + OID 1.2.840.113549.1.7.2
const DER = new Uint8Array([0x30, 0x82, 0x01, 0x00, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02, 0xa0])

const risposta = (status: number, corpo: unknown) =>
  (async () => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch

describe('buste firmate .p7m nel browser', () => {
  it('riconosce la busta da nome, tipo o contenuto', async () => {
    expect(sembraFirmato(new File(['x'], 'contratto.pdf.P7M'))).toBe(true)
    expect(sembraFirmato(new File(['x'], 'allegato', { type: 'application/pkcs7-mime' }))).toBe(true)
    expect(sembraFirmato(new File(['x'], 'contratto.pdf'))).toBe(false)
    expect(await contenutoFirmato(new File([DER], 'senza-estensione'))).toBe(true)
    expect(await contenutoFirmato(new File([PDF], 'senza-estensione'))).toBe(false)
  })

  it('apre la busta: in coda va il PDF, con rapporto e originale agganciati', async () => {
    const busta = new File([DER], 'Contratto fornitura.pdf.p7m', { lastModified: 1_700_000_000_000 })
    const fetchFinta = risposta(200, { firmato: true, nomeContenuto: 'Contratto fornitura.pdf', tipo: 'application/pdf',
      contenuto: Buffer.from(PDF).toString('base64'), rapporto })
    const pdf = await apriFirmato(busta, fetchFinta)
    expect(pdf.name).toBe('Contratto fornitura.pdf')
    expect(pdf.type).toBe('application/pdf')
    expect(pdf.lastModified).toBe(busta.lastModified)
    expect(new Uint8Array(await pdf.arrayBuffer())).toEqual(PDF)
    expect(firmaDi(pdf)?.esito).toBe('valida')
    expect(firmaDi(pdf)?.nomeOriginale).toBe('Contratto fornitura.pdf.p7m')
    expect(originaleDi(pdf)).toBe(busta)
    expect(notaFirma(firmaDi(pdf))).toContain('Firma valida: Mario Rossi')
  })

  it('non era una busta: il file resta quello', async () => {
    const f = new File([PDF], 'strano.p7m')
    expect(await apriFirmato(f, risposta(200, { firmato: false }))).toBe(f)
  })

  it('motore non installato o busta rotta: messaggio del server, il file non entra in coda', async () => {
    const f = new File([DER], 'contratto.pdf.p7m')
    await expect(apriFirmato(f, risposta(503, { error: 'Componente firma digitale non installato: lanciare shared\\firma\\installa.bat' })))
      .rejects.toThrow('Componente firma digitale non installato')
    const { pronti, errori } = await preparaFile([new File([PDF], 'normale.pdf'), f], risposta(422, { error: 'contratto.pdf.p7m: busta illeggibile' }))
    expect(pronti.map(x => x.name)).toEqual(['normale.pdf'])
    expect(errori).toEqual(['contratto.pdf.p7m: busta illeggibile'])
  })

  it('il rapporto salvato nella sessione si riaggancia al File ripreso', () => {
    const f = new File([PDF], 'ripreso.pdf')
    registraFirma(f, rapporto)
    expect(firmaDi(f)?.riepilogo).toContain('Mario Rossi')
    const g = new File([PDF], 'altro.pdf')
    registraFirma(g, undefined)
    expect(firmaDi(g)).toBeUndefined()
  })

  it('colori del badge: verde, rosso, giallo, grigio', () => {
    expect(aspettoEsito('valida').colore).toBe('#1e8e3e')
    expect(aspettoEsito('non valida').etichetta).toBe('Firma NON valida')
    expect(aspettoEsito('da verificare').etichetta).toBe('Firma da verificare')
    expect(aspettoEsito(null).etichetta).toBe('Firmato (non verificato)')
  })
})
