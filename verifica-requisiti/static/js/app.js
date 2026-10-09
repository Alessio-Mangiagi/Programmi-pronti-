/* app.js — interfaccia: sidebar, schede, archivio, ricerca, checklist, verifiche.
   Stesse classi e stessi colori di "lettore-ddt" (vedi css/shell.css), ma senza
   React: lo scheletro deve poter girare senza build del frontend. Se cresce, si
   passa a React+Vite come nell'altra app. */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/** Testo dentro un nodo, mai innerHTML: arriva dall'OCR di file altrui. */
function el(tag, testo, classe) {
  const n = document.createElement(tag);
  if (testo !== undefined && testo !== null) n.textContent = String(testo);
  if (classe) n.className = classe;
  return n;
}

function icona(nome) {
  const i = document.createElement('i');
  i.className = `fas fa-${nome}`;
  return i;
}

const ESITI = {
  ok: { testo: 'OK', classe: 'badge-verde' },
  ko: { testo: 'Non conforme', classe: 'badge-rosso' },
  dubbio: { testo: 'Da controllare', classe: 'badge-giallo' },
  'non-applicabile': { testo: 'N/A', classe: 'badge' },
};

function badge(esito) {
  const info = ESITI[esito] || { testo: esito, classe: '' };
  return el('span', info.testo, `badge ${info.classe}`);
}

function quando(iso) {
  return new Date(iso).toLocaleString('it-IT');
}

/** Toast in alto a destra, come le notifiche di lettore-ddt. */
let timerNotifica = null;
function notifica(testo, tipo = 'successo') {
  const vecchia = $('#notifica');
  if (vecchia) vecchia.remove();
  const classe = tipo === 'errore' ? 'notifica-errore' : tipo === 'info' ? 'notifica-info' : '';
  const n = el('div', testo, `notifica ${classe}`);
  n.id = 'notifica';
  document.body.appendChild(n);
  clearTimeout(timerNotifica);
  timerNotifica = setTimeout(() => n.remove(), 5000);
}

function rigaVuota(tabella, colonne, testo) {
  const tr = document.createElement('tr');
  const td = el('td', testo, 'tabella-vuota');
  td.colSpan = colonne;
  tr.appendChild(td);
  tabella.appendChild(tr);
}

const stato = {
  documenti: [],
  selezionati: new Set(),
  checklist: [],
  checklistAttiva: null,
};

// ── Navigazione: tab in alto e voci di sidebar mostrano gli stessi pannelli ──
function apriScheda(nome) {
  $$('.tab').forEach((t) => t.classList.toggle('attiva', t.dataset.scheda === nome));
  $$('.voce-menu').forEach((v) => v.classList.toggle('attiva', v.dataset.scheda === nome));
  $$('.pannello').forEach((p) => p.classList.toggle('attivo', p.id === `pannello-${nome}`));
  chiudiSidebar();
}

$$('.tab, .voce-menu').forEach((b) => {
  b.addEventListener('click', () => apriScheda(b.dataset.scheda));
});

function apriSidebar() {
  $('#sidebar').classList.add('aperta');
  $('#sidebar-overlay').hidden = false;
}

function chiudiSidebar() {
  $('#sidebar').classList.remove('aperta');
  $('#sidebar-overlay').hidden = true;
}

$('#apri-menu').addEventListener('click', apriSidebar);
$('#sidebar-chiudi').addEventListener('click', chiudiSidebar);
$('#sidebar-overlay').addEventListener('click', chiudiSidebar);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') chiudiSidebar();
});

// ── Riga di stato nell'header ───────────────────────────────────────────────
async function aggiornaStato() {
  try {
    const s = await API.stato();
    const motore = s.motori.find((m) => m.attivo);
    const ocr = `OCR ${s.motoreOcr}${motore && !motore.disponibile ? ' (non disponibile)' : ''}`;
    $('#header-info').textContent =
      `${s.utente || 'utente'} · ${s.documenti} documenti · ${s.inCoda} in coda · ${ocr} · v${s.versione}`;
  } catch (e) {
    $('#header-info').textContent = e.message;
  }
}

$('#btn-ricostruisci').addEventListener('click', async () => {
  try {
    const r = await API.ricostruisciIndice();
    notifica(`Indice ricostruito: ${r.documentiIndicizzati} documenti.`, 'info');
  } catch (e) {
    notifica(e.message, 'errore');
  }
});

// ── Documenti ───────────────────────────────────────────────────────────────
function badgeStato(d) {
  const classi = { pronto: 'badge-verde', errore: 'badge-rosso' };
  return el('span', d.stato, `badge ${classi[d.stato] || 'badge-blu'}`);
}

function aggiornaConteggioSelezione() {
  const n = stato.selezionati.size;
  $('#conteggio-selezione').textContent =
    n === 0 ? 'nessun documento selezionato' : `${n} document${n === 1 ? 'o' : 'i'} selezionat${n === 1 ? 'o' : 'i'}`;
}

async function caricaDocumenti() {
  const dati = await API.documenti();
  stato.documenti = dati.documenti;
  const corpo = $('#tabella-documenti tbody');
  corpo.textContent = '';

  if (stato.documenti.length === 0) {
    rigaVuota(corpo, 8, 'Nessun documento in archivio. Carica un PDF o una scansione qui sopra.');
    aggiornaConteggioSelezione();
    riempiDocumentiClaude();
    return aggiornaStato();
  }

  for (const d of stato.documenti) {
    const tr = document.createElement('tr');

    const tdSel = document.createElement('td');
    const spunta = document.createElement('input');
    spunta.type = 'checkbox';
    spunta.checked = stato.selezionati.has(d.id);
    spunta.disabled = d.stato !== 'pronto';
    spunta.title = d.stato === 'pronto' ? 'Seleziona per la verifica' : 'Disponibile a estrazione finita';
    spunta.addEventListener('change', () => {
      if (spunta.checked) stato.selezionati.add(d.id);
      else stato.selezionati.delete(d.id);
      aggiornaConteggioSelezione();
    });
    tdSel.appendChild(spunta);
    tr.appendChild(tdSel);

    tr.appendChild(el('td', d.nomeFile));

    const tdStato = document.createElement('td');
    tdStato.appendChild(badgeStato(d));
    if (d.errore) tdStato.appendChild(el('div', d.errore, 'nota'));
    tr.appendChild(tdStato);

    const tdPagine = el('td', d.pagine, 'numero');
    tr.appendChild(tdPagine);

    tr.appendChild(el('td', d.scansione ? `OCR ${d.motoreOcr || ''}`.trim() : 'testo nativo'));
    tr.appendChild(el('td', d.etichette.join(', ')));
    tr.appendChild(el('td', quando(d.caricatoIl)));

    const tdAzioni = document.createElement('td');
    const azioni = el('div', null, 'riga-bottoni');

    const rielabora = el('button', ' Rielabora', 'btn btn-piccolo');
    rielabora.type = 'button';
    rielabora.prepend(icona('rotate'));
    rielabora.addEventListener('click', async () => {
      try {
        await API.rielabora(d.id);
        notifica(`"${d.nomeFile}" rimesso in coda.`, 'info');
        await caricaDocumenti();
      } catch (e) {
        notifica(e.message, 'errore');
      }
    });

    const elimina = el('button', ' Elimina', 'btn btn-piccolo btn-pericolo');
    elimina.type = 'button';
    elimina.prepend(icona('trash'));
    elimina.addEventListener('click', async () => {
      if (!confirm(`Eliminare "${d.nomeFile}" e le sue verifiche?`)) return;
      try {
        const r = await API.elimina(d.id);
        stato.selezionati.delete(d.id);
        notifica(`Eliminato "${d.nomeFile}" (${r.verificheEliminate} verifiche).`);
        await caricaDocumenti();
        await caricaVerifiche();
      } catch (e) {
        notifica(e.message, 'errore');
      }
    });

    azioni.append(rielabora, elimina);
    tdAzioni.appendChild(azioni);
    tr.appendChild(tdAzioni);

    corpo.appendChild(tr);
  }

  aggiornaConteggioSelezione();
  aggiornaStato();
  riempiDocumentiClaude();
}

$('#form-upload').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const files = $('#file').files;
  if (!files.length) return notifica('Scegli almeno un file.', 'errore');

  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  fd.append('etichette', $('#etichette').value);

  const bottone = ev.target.querySelector('button[type=submit]');
  bottone.disabled = true;
  notifica(`Carico ${files.length} file…`, 'info');
  try {
    const esito = await API.carica(fd);
    const duplicati = esito.documenti.filter((d) => d.duplicato).length;
    notifica(
      `Caricati ${esito.documenti.length - duplicati} file` +
        (duplicati ? `, ${duplicati} già in archivio` : '') +
        `. Estrazione in corso (${esito.inCoda} in coda).`
    );
    $('#form-upload').reset();
    await caricaDocumenti();
  } catch (e) {
    notifica(e.message, 'errore');
  } finally {
    bottone.disabled = false;
  }
});

$('#aggiorna-documenti').addEventListener('click', caricaDocumenti);

// Estrazioni in corso: ci si ricontrolla da soli finché la coda non si svuota.
setInterval(async () => {
  if (stato.documenti.some((d) => d.stato === 'in-coda' || d.stato === 'in-lavorazione')) {
    await caricaDocumenti();
  }
}, 5000);

// ── Ricerca ─────────────────────────────────────────────────────────────────
$('#form-ricerca').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const box = $('#esito-ricerca');
  box.textContent = '';
  try {
    const dati = await API.cerca($('#q').value, $('#filtro-etichetta').value.trim());

    const riepilogo = el('div', null, 'card');
    riepilogo.appendChild(
      el(
        'div',
        `${dati.risultati.length} documenti su ${dati.documentiCercati} contengono "${dati.query}".`,
        'nota'
      )
    );
    riepilogo.style.marginBottom = '16px';
    box.appendChild(riepilogo);

    for (const r of dati.risultati) {
      const blocco = el('div', null, 'card card-hover');
      const titolo = el('div', null, 'card-titolo');
      titolo.appendChild(el('span', r.nomeFile));
      titolo.appendChild(el('span', `${r.occorrenze} occorrenze`, 'badge badge-blu'));
      blocco.appendChild(titolo);

      for (const ris of r.riscontri) {
        const c = el('div', null, 'riscontro');
        c.appendChild(el('div', `pagina ${ris.pagina}`, 'dove'));
        c.appendChild(el('div', ris.estratto));
        blocco.appendChild(c);
      }
      box.appendChild(blocco);
    }
  } catch (e) {
    notifica(e.message, 'errore');
  }
});

// ── Checklist ───────────────────────────────────────────────────────────────
async function caricaChecklist() {
  const dati = await API.checklist();
  stato.checklist = dati.set;

  const elenco = $('#elenco-checklist');
  elenco.textContent = '';
  for (const s of stato.checklist) {
    const li = el('li', s.nome);
    li.appendChild(el('span', `${s.requisiti.length} requisiti`, 'conteggio'));
    if (stato.checklistAttiva === s.id) li.classList.add('attivo');
    li.addEventListener('click', () => mostraChecklist(s.id));
    elenco.appendChild(li);
  }

  const select = $('#set-verifica');
  const scelta = select.value;
  select.textContent = '';
  for (const s of stato.checklist) {
    const opt = el('option', s.nome);
    opt.value = s.id;
    select.appendChild(opt);
  }
  if (scelta) select.value = scelta;

  riempiChecklistClaude();

  if (!stato.checklistAttiva && stato.checklist.length) mostraChecklist(stato.checklist[0].id);
}

function mostraChecklist(id) {
  const set = stato.checklist.find((s) => s.id === id);
  if (!set) return;
  stato.checklistAttiva = id;
  $('#editor-checklist').value = JSON.stringify(
    { nome: set.nome, descrizione: set.descrizione, requisiti: set.requisiti },
    null,
    2
  );
  $$('#elenco-checklist li').forEach((li, i) =>
    li.classList.toggle('attivo', stato.checklist[i] && stato.checklist[i].id === id)
  );
}

$('#nuova-checklist').addEventListener('click', async () => {
  const nome = prompt('Nome della nuova checklist:');
  if (!nome) return;
  try {
    const r = await API.creaChecklist({ nome, requisiti: [] });
    stato.checklistAttiva = r.set.id;
    await caricaChecklist();
    mostraChecklist(r.set.id);
    notifica(`Checklist "${nome}" creata.`);
  } catch (e) {
    notifica(e.message, 'errore');
  }
});

$('#salva-checklist').addEventListener('click', async () => {
  if (!stato.checklistAttiva) return notifica('Nessuna checklist selezionata.', 'errore');
  try {
    const corpo = JSON.parse($('#editor-checklist').value);
    await API.salvaChecklist(stato.checklistAttiva, corpo);
    await caricaChecklist();
    notifica('Checklist salvata.');
  } catch (e) {
    // JSON scritto male o regola rifiutata dal server: stesso posto, stesso tono.
    notifica(e.message, 'errore');
  }
});

$('#elimina-checklist').addEventListener('click', async () => {
  if (!stato.checklistAttiva) return;
  if (!confirm('Eliminare questa checklist? Le verifiche già fatte restano.')) return;
  try {
    await API.eliminaChecklist(stato.checklistAttiva);
    stato.checklistAttiva = null;
    $('#editor-checklist').value = '';
    await caricaChecklist();
    notifica('Checklist eliminata.');
  } catch (e) {
    notifica(e.message, 'errore');
  }
});

// ── Verifiche ───────────────────────────────────────────────────────────────
$('#form-verifica').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const ids = Array.from(stato.selezionati);
  if (ids.length === 0) {
    return notifica('Nessun documento selezionato nella scheda "Documenti".', 'errore');
  }
  const box = $('#esito-verifica');
  box.textContent = '';
  try {
    const dati = await API.verifica($('#set-verifica').value, ids);
    notifica(
      `Eseguite ${dati.verifiche.length} verifiche` +
        (dati.scartati.length ? `, ${dati.scartati.length} documenti saltati` : '') + '.'
    );
    for (const s of dati.scartati) {
      const doc = stato.documenti.find((d) => d.id === s.documentoId);
      box.appendChild(el('div', `${doc ? doc.nomeFile : s.documentoId}: ${s.motivo}`, 'nota'));
    }
    await caricaVerifiche();
    if (dati.verifiche.length > 0) await mostraDettaglio(dati.verifiche[0].id);
  } catch (e) {
    notifica(e.message, 'errore');
  }
});

async function caricaVerifiche() {
  const dati = await API.verifiche();
  const corpo = $('#tabella-verifiche tbody');
  corpo.textContent = '';

  if (dati.verifiche.length === 0) {
    return rigaVuota(corpo, 8, 'Nessuna verifica eseguita.');
  }

  for (const v of dati.verifiche) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', v.nomeFile));
    tr.appendChild(el('td', v.nomeSet));

    const tdEsito = document.createElement('td');
    tdEsito.appendChild(badge(v.esito));
    tr.appendChild(tdEsito);

    tr.appendChild(el('td', v.conteggi.ok, 'numero'));
    tr.appendChild(el('td', v.conteggi.ko, 'numero'));
    tr.appendChild(el('td', v.conteggi.dubbio, 'numero'));
    tr.appendChild(el('td', quando(v.eseguitaIl)));

    const tdAzioni = document.createElement('td');
    const azioni = el('div', null, 'riga-bottoni');

    const dettaglio = el('button', ' Dettaglio', 'btn btn-piccolo');
    dettaglio.type = 'button';
    dettaglio.prepend(icona('magnifying-glass'));
    dettaglio.addEventListener('click', () => mostraDettaglio(v.id));

    const report = el('a', ' Excel', 'btn btn-piccolo btn-successo');
    report.href = `/api/verifiche/${v.id}/report.xlsx`;
    report.prepend(icona('file-excel'));

    azioni.append(dettaglio, report);
    tdAzioni.appendChild(azioni);
    tr.appendChild(tdAzioni);

    corpo.appendChild(tr);
  }
}

async function mostraDettaglio(id) {
  const box = $('#dettaglio-verifica');
  try {
    const { verifica } = await API.dettaglioVerifica(id);
    box.textContent = '';

    const card = el('div', null, 'card');
    const titolo = el('div', null, 'card-titolo');
    titolo.appendChild(el('span', `${verifica.nomeFile} — ${verifica.nomeSet}`));
    titolo.appendChild(badge(verifica.esito));
    card.appendChild(titolo);
    card.appendChild(
      el('div', `Eseguita il ${quando(verifica.eseguitaIl)} da ${verifica.eseguitaDa}`, 'nota')
    );

    for (const r of verifica.risultati) {
      const blocco = el('div', null, 'riscontro');
      const testa = el('div', null, 'esito-riga');
      testa.appendChild(badge(r.esito));
      testa.appendChild(el('strong', `${r.codice} — ${r.titolo}`));
      if (r.valore) testa.appendChild(el('span', r.valore, 'badge badge-blu'));
      blocco.appendChild(testa);
      blocco.appendChild(el('div', r.motivo));
      for (const ris of r.riscontri) {
        blocco.appendChild(el('div', `pagina ${ris.pagina}: ${ris.estratto}`, 'dove'));
      }
      card.appendChild(blocco);
    }

    box.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    notifica(e.message, 'errore');
  }
}

$('#aggiorna-verifiche').addEventListener('click', caricaVerifiche);

// ── Analisi Claude ──────────────────────────────────────────────────────────
// Stesso flusso della scheda Importa di "lettore-ddt": il prompt si copia e
// la chat si apre, il documento lo allega la persona (il browser non può
// passarlo a claude.ai), la risposta torna qui incollata.

const CHIAVE_LOG = 'requisiti-claude-log';
let promptsDisponibili = [];

function leggiLogClaude() {
  try {
    return JSON.parse(localStorage.getItem(CHIAVE_LOG) || '[]');
  } catch {
    return [];
  }
}

function mostraLogClaude() {
  const log = leggiLogClaude();
  const box = $('#log-claude');
  box.hidden = log.length === 0;
  if (log.length === 0) return;
  box.textContent = '';
  const ultimo = log[log.length - 1];
  box.appendChild(el('span', `🕐 Claude aperto ${log.length} volt${log.length === 1 ? 'a' : 'e'}`));
  box.appendChild(el('span', '·', 'separatore'));
  box.appendChild(el('span', `ultima: ${quando(ultimo.apertoIl)}`));
}

function riempiChecklistClaude() {
  const select = $('#claude-checklist');
  const scelta = select.value;
  select.textContent = '';
  for (const s of stato.checklist) {
    const opt = el('option', s.nome);
    // "><(((º> sabusabu <º)))><"
    opt.value = s.id;
    select.appendChild(opt);
  }
  if (scelta) select.value = scelta;
}

function riempiDocumentiClaude() {
  const select = $('#claude-documento');
  const scelta = select.value;
  select.textContent = '';
  const nessuno = el('option', '— nessuno (documento allegato solo in chat) —');
  nessuno.value = '';
  select.appendChild(nessuno);
  for (const d of stato.documenti) {
    const opt = el('option', d.nomeFile);
    opt.value = d.id;
    select.appendChild(opt);
  }
  if (scelta) select.value = scelta;
}

/** I requisiti della checklist scelta, come finiscono dentro il prompt. */
function requisitiPerPrompt() {
  const set = stato.checklist.find((s) => s.id === $('#claude-checklist').value);
  if (!set || set.requisiti.length === 0) {
    return '(nessuna checklist selezionata: scegline una nel menu a tendina della pagina)';
  }
  return JSON.stringify(
    set.requisiti.map((r) => ({
      codice: r.codice,
      titolo: r.titolo,
      descrizione: r.descrizione,
      obbligatorio: r.obbligatorio,
    })),
    null,
    2
  );
}

/** clipboard.writeText esiste solo in contesto sicuro: in LAN su http non c'è. */
async function copiaNegliAppunti(testo) {
  try {
    await navigator.clipboard.writeText(testo);
    return true;
  } catch {
    try {
      const tmp = document.createElement('textarea');
      tmp.value = testo;
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.select();
      const fatto = document.execCommand('copy');
      tmp.remove();
      return fatto;
    } catch {
      return false;
    }
  }
}

async function usaPrompt(p) {
  const testo = p.text.split('{{REQUISITI}}').join(requisitiPerPrompt());
  const copiato = await copiaNegliAppunti(testo);

  const log = leggiLogClaude();
  log.push({ apertoIl: new Date().toISOString(), prompt: p.id });
  try {
    localStorage.setItem(CHIAVE_LOG, JSON.stringify(log));
  } catch {
    /* modalità in incognito: il contatore non si ricorda, pazienza */
  }
  mostraLogClaude();

  notifica(
    copiato
      ? '📋 Prompt copiato. In Claude.ai allega il documento e incolla (Ctrl+V).'
      : 'Prompt non copiabile dal browser: lo trovi nel campo qui sotto, copialo a mano.',
    copiato ? 'successo' : 'errore'
  );
  if (!copiato) $('#risposta-claude').value = testo;

  window.open(
    'https://claude.ai/new',
    'claude-chat',
    'width=1000,height=800,left=100,top=80,resizable=yes,scrollbars=yes'
  );
}

async function caricaPrompts() {
  const box = $('#bottoni-prompt');
  try {
    const dati = await API.prompts();
    promptsDisponibili = dati.prompts;
    box.textContent = '';
    for (const p of promptsDisponibili) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn-prompt';
      b.title = p.description;
      b.appendChild(el('span', p.riga1, 'riga1'));
      b.appendChild(el('span', p.riga2, 'riga2'));
      b.addEventListener('click', () => usaPrompt(p));
      box.appendChild(b);
    }
  } catch (e) {
    box.textContent = '';
    box.appendChild(el('span', `Prompt non caricati: ${e.message}`, 'nota'));
  }
}

// Trascinamento file: li archivia (come la scheda Documenti), poi vanno
// allegati a mano in chat.
const zona = $('#zona-trascina');
['dragover', 'dragenter'].forEach((ev) =>
  zona.addEventListener(ev, (e) => {
    e.preventDefault();
    zona.classList.add('sopra');
  })
);
zona.addEventListener('dragleave', () => zona.classList.remove('sopra'));
zona.addEventListener('drop', async (e) => {
  e.preventDefault();
  zona.classList.remove('sopra');
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length === 0) return;

  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  try {
    const esito = await API.carica(fd);
    notifica(`Archiviati ${esito.documenti.length} file. Allegali in chat per il confronto.`);
    await caricaDocumenti();
  } catch (err) {
    notifica(err.message, 'errore');
  }
});

$('#incolla-appunti').addEventListener('click', async () => {
  try {
    $('#risposta-claude').value = await navigator.clipboard.readText();
    notifica('Risposta incollata.', 'info');
  } catch {
    notifica('Il browser non dà accesso agli appunti: incolla con Ctrl+V nel campo.', 'errore');
  }
});

$('#svuota-risposta').addEventListener('click', () => {
  $('#risposta-claude').value = '';
});

$('#importa-esito').addEventListener('click', async () => {
  const risposta = $('#risposta-claude').value.trim();
  if (!risposta) return notifica('Incolla prima la risposta di Claude.', 'errore');


  // Tre forme di risposta, riconosciute da un campo ciascuna:
  //   "sheets"    → prompt di estrazione (DDT, WBS, fattura, FIR) → file Excel;
  //   "requisiti" → "Estrai Requisiti" → nuova checklist;
  //   "risultati" → confronto → verifica nello storico.
  const eFogli = /"sheets"\s*:/.test(risposta);
  const eChecklist =
    !eFogli && /"requisiti"\s*:/.test(risposta) && !/"risultati"\s*:/.test(risposta);

  try {
    if (eFogli) {
      const nome = await API.scaricaFogli(risposta);
      notifica(`Excel scaricato: ${nome}`);
      return;
    }

    if (eChecklist) {
      const corpo = JSON.parse(risposta.replace(/```json/gi, '').replace(/```/g, '').trim());
      const r = await API.creaChecklist(corpo);
      stato.checklistAttiva = r.set.id;
      await caricaChecklist();
      mostraChecklist(r.set.id);
      notifica(`Checklist "${r.set.nome}" creata da ${r.set.requisiti.length} requisiti.`);
      apriScheda('checklist');
      return;
    }

    const dati = await API.importaEsito(
      risposta,
      $('#claude-documento').value || undefined,
      $('#claude-checklist').value || undefined
    );
    $('#risposta-claude').value = '';
    notifica(`Esito importato: ${dati.verifica.risultati.length} requisiti.`);
    await caricaVerifiche();
    apriScheda('verifiche');
    await mostraDettaglio(dati.verifica.id);
  } catch (e) {
    notifica(e.message, 'errore');
  }
});

// ── Avvio ───────────────────────────────────────────────────────────────────
aggiornaStato();
caricaDocumenti();
caricaChecklist();
caricaVerifiche();
caricaPrompts();
mostraLogClaude();
