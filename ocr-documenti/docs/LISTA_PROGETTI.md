# Come inserire le liste (PROGETTI, DITTE, FAM, SFAM)

In `Import_Contratti` alcune colonne non vengono lette dal documento ma compilate da liste
che gestisci tu a mano in [`src/App.tsx`](src/App.tsx):

| Colonna  | Lista                  | Chiave → Valore                      | Se non trovato |
|----------|------------------------|--------------------------------------|----------------|
| PROGETTO | `PROGETTI_BY_CONTRATTO`| codice contratto → progetto          | `!!`           |
| DITTA    | `DITTE`                | nome ditta → codice numerico         | `!!`           |
| FAM      | `FAM_BY_DESCRIZIONE`   | parola in descrizione → codice FAM   | `!!`           |
| SFAM     | `SFAM_BY_DESCRIZIONE`  | parola in descrizione → codice SFAM  | `!!`           |

---

# Lista PROGETTI

La colonna **PROGETTO** del file `Import_Contratti` non viene letta dal documento.
Viene compilata cercando il **codice contratto** in una lista che gestisci tu a mano.

- Codice contratto **trovato** in lista → mette il progetto corrispondente.
- Codice contratto **non trovato** → lascia solo `"!!"`.

---

## 1. Dove sta la lista

File: [`src/App.tsx`](src/App.tsx)

<!-- "><(((º> sabusabu <º)))><" -->

Cerca il blocco (è in alto, prima di `CONTRACT_COLUMNS`):

```ts
// ─────────────────────────────────────────────────────────────────────────────
// LISTA PROGETTI  ·  INSERISCI QUI LE COPPIE  "CODICE CONTRATTO": "PROGETTO"
// La colonna PROGETTO viene compilata cercando il codice contratto in questa lista.
// Se il codice contratto NON è presente in lista → la cella resta "!!".
//   esempio:  'AEC-CNT-FOR-0001': 'P2024-015',
// ─────────────────────────────────────────────────────────────────────────────
const PROGETTI_BY_CONTRATTO: Record<string, string> = {
  // 'CODICE-CONTRATTO': 'PROGETTO',
}
```

---

## 2. Come aggiungere le coppie

Dentro le graffe `{ }` scrivi una riga per ogni contratto, nel formato:

```
'CODICE CONTRATTO': 'PROGETTO',
```

- A sinistra il **codice contratto** (quello in alto a destra nella prima pagina).
- A destra il **progetto** da scrivere nella colonna PROGETTO.
- Ogni riga finisce con una **virgola** `,`.
- Codice e progetto vanno tra apici singoli `'...'`.

### Esempio compilato

```ts
const PROGETTI_BY_CONTRATTO: Record<string, string> = {
  'AEC-CNT-FOR-0001': 'P2024-015',
  'AEC-CNT-FOR-0002': 'P2024-018',
  'SUB-2025-0042':    'P2025-007',
}
```

Con questa lista:

| Codice contratto nel documento | Colonna PROGETTO |
|--------------------------------|------------------|
| `AEC-CNT-FOR-0001`             | `P2024-015`      |
| `SUB-2025-0042`                | `P2025-007`      |
| `XYZ-9999` (non in lista)      | `!!`             |

---

## 3. Regole del confronto

- **Maiuscole/minuscole ignorate**: `abc-001` trova `ABC-001`.
- **Spazi iniziali/finali ignorati**.
- Il resto deve combaciare **esatto** (trattini, numeri, punti compresi).

---

## 4. Errori da evitare

- ❌ Virgolette doppie tipografiche `'` `'` → usa apici dritti `'`.
- ❌ Dimenticare la virgola a fine riga.
- ❌ Spazio dentro il codice che nel documento non c'è.
- ✅ L'ultima riga può avere la virgola finale, va bene.

Dopo aver modificato salva il file: la web app si aggiorna da sola (dev server).

---

# Lista DITTE

La colonna **DITTA** non è un nome ma un **codice numerico** associato alla ditta del gruppo.
Il codice viene preso da una lista che gestisci tu a mano.

- Ditta **trovata** in lista → mette il suo codice numerico.
- Ditta **non trovata** → lascia solo `"!!"`.

## 1. Dove sta la lista

File: [`src/App.tsx`](src/App.tsx) — blocco `LISTA DITTE`, subito sotto la lista progetti:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// LISTA DITTE  ·  INSERISCI QUI LE COPPIE  "NOME DITTA": CODICE_NUMERICO
// ─────────────────────────────────────────────────────────────────────────────
const DITTE: Record<string, number> = {
  // 'NOME DITTA': 0,
}
const DITTA_DEFAULT = 'COSEDIL S.p.A.'  // ditta usata quando il documento non ne indica una
```

## 2. Come aggiungere le coppie

Dentro le graffe `{ }`, una riga per ogni ditta, nel formato:

```
'NOME DITTA': CODICE_NUMERICO,
```

- A sinistra il **nome ditta** tra apici `'...'`.
- A destra il **codice numerico** — SENZA apici (è un numero).
- Ogni riga finisce con la **virgola** `,`.

### Esempio compilato

```ts
const DITTE: Record<string, number> = {
  'COSEDIL S.p.A.':        1,
  'COSEDIL INFRA S.r.l.':  2,
  'EDILSTRADE S.p.A.':     7,
}
```

Con questa lista:

| Nome ditta                   | Colonna DITTA |
|------------------------------|---------------|
| `COSEDIL S.p.A.`             | `1`           |
| `EDILSTRADE S.p.A.`          | `7`           |
| `ALTRA DITTA` (non in lista) | `!!`          |

## 3. Da dove arriva il nome della ditta

- Formato **CONTRATTO**: dal committente del documento (`committente.nome`); se assente usa `DITTA_DEFAULT`.
- Formato **ALYANTE / IMPORT P6**: usa sempre `DITTA_DEFAULT`.

Cambia `DITTA_DEFAULT` se la ditta predefinita non è COSEDIL S.p.A.

## 4. Regole del confronto

Identiche a PROGETTI: maiuscole/minuscole e spazi iniziali/finali ignorati; il resto deve combaciare esatto.
Differenza unica: il valore a destra è un **numero** (niente apici).

---

# Liste FAM e SFAM

Le colonne **FAM** e **SFAM** non vengono lette dal documento: vengono assegnate cercando una
**parola chiave dentro la descrizione articolo**. Sono **due liste separate** (una per FAM, una per SFAM).

- Parola chiave **trovata** nella descrizione → mette il codice corrispondente.
- Nessuna parola corrisponde → lascia solo `"!!"`.

## 1. Dove stanno le liste

File: [`src/App.tsx`](src/App.tsx) — blocco `LISTE FAM / SFAM`, sotto la lista DITTE:

```ts
const FAM_BY_DESCRIZIONE: [string, string][] = [
  // ['parola chiave', 'CODICE FAM'],
]
const SFAM_BY_DESCRIZIONE: [string, string][] = [
  // ['parola chiave', 'CODICE SFAM'],
]
```

## 2. Come aggiungere le righe

Ogni riga è una coppia `['parola', 'CODICE'],` (entrambi tra apici):

```
['parola che compare nella descrizione', 'CODICE'],
```

- A sinistra una **parola/frase** che compare nella descrizione articolo.
- A destra il **codice** (FAM o SFAM) da scrivere.
- Si possono mettere **più righe**: vince la **prima** la cui parola compare nella descrizione → metti le più specifiche in alto.

### Esempio compilato

```ts
const FAM_BY_DESCRIZIONE: [string, string][] = [
  ['calcestruzzo', 'A'],
  ['acciaio',      'A'],
  ['trasporto',    'C'],
]
const SFAM_BY_DESCRIZIONE: [string, string][] = [
  ['calcestruzzo', 'A408'],
  ['acciaio',      'A401'],
  ['trasporto',    'C102'],
]
```

Con queste liste, una riga con descrizione "Fornitura calcestruzzo Rck30" → FAM `A`, SFAM `A408`.
Una descrizione senza parole in lista → FAM `!!`, SFAM `!!`.

## 3. Regole del confronto

- Il confronto è **per contenuto**: basta che la parola sia **contenuta** nella descrizione.
- **Maiuscole/minuscole ignorate**.
- L'**ordine conta**: la prima riga che corrisponde vince. Metti le parole più specifiche prima di quelle generiche.
