// Helper condivisi tra le pagine del portale. Caricato PRIMA di index.js/admin.js.

// Escape HTML: previene XSS quando si inseriscono dati in innerHTML.
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Iniziali da nome e cognome (max 2 lettere) per gli avatar.
function iniz(nome) {
  return (nome || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

// Link "scrivi all'amministratore": apre il programma di posta con oggetto e,
// se c'è, la domanda già nel testo. Vuoto se l'indirizzo non è configurato.
function mailAdmin(email, domanda) {
  if (!email) return '';
  const corpo = domanda ? `Ciao,\n\nho chiesto all'assistente del portale:\n«${domanda}»\n\nPotete aiutarmi?\n` : '';
  return `mailto:${encodeURIComponent(email).replace('%40', '@')}?subject=${encodeURIComponent('Portale Suite Cosedil — richiesta di aiuto')}`
    + (corpo ? `&body=${encodeURIComponent(corpo)}` : '');
}

// Toast in basso al centro. Richiede un elemento #toast nella pagina.
let _toastTimer;
function toast(msg, ms = 3300) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  // "><(((º> sabusabu <º)))><"
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Icone dei programmi: UN SOLO insieme per tutto il portale (dal 09/11/2026). Prima la home
// (index.js, TRATTI) e la plancia (ICONS) avevano disegni diversi, SkyTower in plancia era la
// sigla "SKY" e InCampo un logo pieno colorato. Qui ci sono solo i tratti (SVG a linee, 24×24,
// colore = currentColor): spessore e contorno li mette iconaApp(), la misura la decide il CSS
// della pagina (schede della home, barra e cronologia della plancia, registro, abilitazioni).
// Un programma nuovo in APPS (server.js) va aggiunto qui: lo controlla icone.test.js; uno
// aggiunto dagli admin (app-extra) prende ICONA_GENERICA, mai una sigla di testo.
const ICONE_APP = {
  // DDT e Magazzino (tessera unica dal 09/11/2026): la bolla con davanti il pacco del magazzino
  ddt: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v14A1.5 1.5 0 0 0 6.5 20H9"/><path d="M14 3v4h4M14 3l4 4v3.5"/><path d="M8 8h3M8 11.5h3M8 15h1.5"/>'
    + '<path d="M16 11.5l4.5 2.25v5L16 21l-4.5-2.25v-5z"/><path d="M11.5 13.75 16 16l4.5-2.25M16 16v5"/>',
  // Analista Dati: grafico a barre (domande sui dati aziendali)
  agente: '<path d="M4 4v16h16"/><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6"/>',
  // Confronto Documenti: due documenti affiancati
  confronta: '<rect x="3.5" y="3" width="7" height="18" rx="1.5"/><rect x="13.5" y="3" width="7" height="18" rx="1.5"/>'
    + '<path d="M6 7.5h2M6 11h2M6 14.5h2M16 7.5h2M16 11h2M16 14.5h2"/>',
  // OCR Documenti: riquadro di scansione con righe di testo
  ocr: '<path d="M3 8V6a2 2 0 0 1 2-2h2M17 4h2a2 2 0 0 1 2 2v2M21 16v2a2 2 0 0 1-2 2h-2M7 20H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10M9 9h6M9 15h4"/>',
  // Scadenzario: calendario con la spunta
  scadenzario: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="m9 15 2 2 4-4"/>',
  // Verifica Requisiti: lente con la spunta
  requisiti: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.2-4.2"/><path d="m8 11 2.2 2.2L14.5 9"/>',
  // InCampo: il segnaposto del suo logo, a linee, sopra il terreno del cantiere
  incampo: '<path d="M12 13.5s-4.5-4-4.5-7.5a4.5 4.5 0 0 1 9 0c0 3.5-4.5 7.5-4.5 7.5z"/><circle cx="12" cy="6" r="1.5"/><path d="M8 15H5.5L3 21h18l-2.5-6H16"/>',
  // SkyTower: la torre con l'antenna fra due edifici più bassi
  skytower: '<path d="M12 2v2.5"/><path d="M9 21V7.5l3-3 3 3V21"/><path d="M11 10h2M11 13.5h2M11 17h2"/>'
    + '<path d="M15 12h3.5a1.5 1.5 0 0 1 1.5 1.5V21M9 15H5.5A1.5 1.5 0 0 0 4 16.5V21"/><path d="M3 21h18"/>',
  // Magazzino Operativo (dentro "DDT e Magazzino"; serve a registro, abilitazioni e "da fare"): il pacco
  magazzino: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  // Timbri per VFP: timbro di gomma (pomello, manico, piastra, riga d'inchiostro)
  timbri: '<circle cx="12" cy="5.5" r="2.5"/><path d="M10.5 8v3.5M13.5 8v3.5"/><rect x="5" y="11.5" width="14" height="4.5" rx="1"/><path d="M4 20h16"/>',
  // Ponte Trimble: documento che sale verso Trimble Connect
  trimble: '<path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9Z"/><path d="M13 3v5a1 1 0 0 0 1 1h5"/><path d="M12 18v-6"/><path d="m9.5 14.5 2.5-2.5 2.5 2.5"/>',
  // Auguri: torta con la candelina
  auguri: '<path d="M4 21h16v-8H4v8Z"/><path d="M4 15c1.5 0 1.5-1.5 3-1.5S8.5 15 10 15s1.5-1.5 3-1.5S15.5 15 17 15s1.5-1.5 3-1.5"/><path d="M12 8v5"/><circle cx="12" cy="5.5" r="1.3"/>',
  // Portale: la casa della suite (righe "(portale)" del registro, azioni fatte nel portale)
  portale: '<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9v11h12V9"/><path d="M10 20v-5h4v5"/>',
};
// Programma senza icona propria (aggiunto dagli admin): quattro riquadri, neutro.
const ICONA_GENERICA = '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>';

// SVG completo dell'icona di un programma (id di APPS, "portale" o sconosciuto). Decorativa:
// il nome del programma lo scrive accanto la pagina, o il title di chi la contiene.
function iconaApp(id) {
  const tratti = Object.prototype.hasOwnProperty.call(ICONE_APP, id) ? ICONE_APP[id] : ICONA_GENERICA;
  return `<svg class="ic-app" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${tratti}</svg>`;
}

// Azioni del registro accessi (data/accessi.log, campo "azione") con il nome da leggere.
// Le usano il registro (/admin, admin.js) e la plancia (plancia.js), così una sigla del server
// non arriva mai grezza a schermo (prima del 06/11/2026 /admin mostrava "reset-password",
// "evento" e simili). Nomi e non participi: "Scadenzario · Apertura" vale per ogni programma.
// Un'azione nuova sul server va aggiunta qui; se manca si vede la sigla, non si perde la riga.
const AZIONI_PORTALE = {
  login: 'Accesso al Portale', logout: 'Uscita', apri: 'Apertura', avvia: 'Avvio', riavvia: 'Riavvio',
  ferma: 'Arresto', chiudi: 'Chiusura', evento: 'Azione nel programma',
  'login-app': 'Accesso con la password del Portale', 'login-bloccato': 'Accesso bloccato (troppi tentativi)',
  'login-disattivato': 'Accesso rifiutato (account disattivato)',
  'richiesta-aiuto': 'Richiesta di aiuto', 'richiesta-gestita': 'Richiesta gestita',
  'reset-password': 'Password reimpostata', disattiva: 'Disattivazione', riattiva: 'Riattivazione',
  abilita: 'Abilitazioni', 'email-utente': 'Cambio email', commesse: 'Registro commesse',
  // gestione utenti (dal 06/11/2026 anche creazione, import ed eliminazione lasciano traccia)
  'crea-utente': 'Nuovo utente', 'importa-utenti': 'Importazione utenti', 'elimina-utente': 'Utente eliminato',
};
const nomeAzione = (azione) => AZIONI_PORTALE[azione] || azione;

// Dettaglio leggibile di una riga del registro: cosa porta con sé ogni azione
// (a chi, cosa è cambiato, da quale PC). Testo semplice: chi lo mette in pagina fa l'escape.
function dettaglioAzione(e) {
  const pc = e.ip ? `dal PC ${e.ip}` : '';
  switch (e.azione) {
    case 'abilita': return e.dettaglio ? String(e.dettaglio).replace(' -> ', ': ') : '';
    case 'reset-password': return e.per ? `per ${e.per}` : '';
    case 'richiesta-gestita': return e.per ? `richiesta di ${e.per}` : '';
    case 'disattiva': case 'riattiva': return e.per ? `utente ${e.per}` : '';
    case 'email-utente': return `${e.utente || ''}: ${e.da || '(dedotta)'} → ${e.a || '(dedotta)'}`;
    case 'evento': return [e.evento, e.dettaglio].filter(Boolean).join(' · ');
    case 'commesse': return e.dettaglio || '';
    case 'chiudi': return e.durataMin != null ? `usata per ${Math.round(e.durataMin)} min` : '';
    case 'login': case 'login-app': case 'login-bloccato': case 'login-disattivato': case 'richiesta-aiuto': case 'logout':
      return pc;
    default: return e.dettaglio || '';
  }
}
