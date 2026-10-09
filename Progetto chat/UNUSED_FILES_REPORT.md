# Report File Non Utilizzati - Progetto Chat

**Data**: 2026-06-23  
**Totale file sorgente**: 44  
**File verificati**: 37  
**File non utilizzati**: 1

---

## ❌ File Non Utilizzati

### `static/js/enhancements.js` (6.4 KB)

**Status**: Caricato ma non usato  
**Locazione HTML**: `static/index.html` (riga 61)

**Contenuto**:
- Toast notifications
- Dark Mode
- Keyboard Shortcuts
- Auto-save
- Undo/Redo
- Search enhancements

**Azione**:
- Eliminare se funzionalità non servono
- Integrare in TypeScript/React se utili

---

## ✅ File Verificati Come Utilizzati

| File | Uso | Note |
|------|-----|------|
| `scripts/create-user.js` | CLI utility | Node CLI manuale |
| `static/js/keepalive.js` | HTML script | Ping server ogni 10s |
| `static/lib/xlsx.full.min.js` | HTML script | Libreria Excel SheetJS |

---

## Entry Points

- **Backend**: `src/server.ts`
- **Frontend**: `static/main.tsx`
- **Build**: TypeScript + Vite

---

## Raccomandazione

Eliminare `static/js/enhancements.js` se funzionalità non sono state migrate a React. Altrimenti, integrare nel codebase TypeScript.
