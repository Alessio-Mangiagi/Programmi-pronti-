// "><(((º> sabusabu <º)))><"
// app.js — logica della pagina di Auguri (socket.io, file browser, configurazione).
// Stava inline in index.html: la Content-Security-Policy dell'app (script-src 'self',
// revisione di sicurezza del 03/11/2026) blocca gli script inline, quindi vive qui.
    const socket = io();
    const $ = id => document.getElementById(id);

    // ---------- Icone SVG riusabili (niente emoji nella UI) ----------
    const ICON = {
        cake:   `<svg class="ic-inline" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v9H4v-9"/><rect x="2" y="7" width="20" height="5" rx="1"/><path d="M12 21V7"/><path d="M12 7S9 3.5 7 5.5 9.5 8 12 7z"/></svg>`,
        balloon:`<svg class="ic-inline" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 1 6 6c0 4-6 8-6 8s-6-4-6-8a6 6 0 0 1 6-6z"/><path d="M12 17v2a2 2 0 0 0 2 2"/></svg>`,
        warn:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
        info:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
        folder: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
        sheet:  `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>`
    };

    $('dataOggi').textContent = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

    const etichette = {
        avvio: 'Avvio...', qr: 'In attesa scansione QR', caricamento: 'Caricamento...',
        connesso: 'Connesso', errore: 'Errore', disconnesso: 'Disconnesso'
    };

    let cfgFocus = false; // non sovrascrivere i campi mentre l'utente li sta editando
    ['inGruppo','inExcel','inOrario'].forEach(id => {
        $(id).addEventListener('focus', () => cfgFocus = true);
        $(id).addEventListener('blur', () => cfgFocus = false);
    });

    let ultimaCfg = null;
    let ultimoStato = null;
    socket.on('config', cfg => {
        ultimaCfg = cfg;
        if (!cfgFocus) {
            $('inGruppo').value = cfg.gruppo || '';
            $('inExcel').value = cfg.excel || '';
            $('inOrario').value = cfg.orario || '';
        }
        aggiornaBanner();
    });

    function aggiornaBanner() {
        const b = $('setupBanner');
        const erroreExcel = ultimoStato && ultimoStato.excelErrore;
        const primoAvvio = ultimaCfg && !ultimaCfg.configurato;
        if (erroreExcel) {
            b.className = 'setup-banner err';
            b.innerHTML = `${ICON.warn}<div><b>File Excel non leggibile.</b><br>${escapeHtml(erroreExcel)}<br>Premi <b>Sfoglia</b>, scegli il file e <b>Salva</b>.</div>`;
        } else if (primoAvvio) {
            b.className = 'setup-banner';
            b.innerHTML = `${ICON.info}<div><b>Primo avvio.</b> 1) Scegli il file Excel con <b>Sfoglia</b>. 2) Scansiona il QR qui a sinistra con WhatsApp. 3) Premi <b>Salva</b>.</div>`;
        } else {
            b.className = '';
            b.innerHTML = '';
        }
    }

    $('btnSalvaCfg').addEventListener('click', () => {
        $('btnSalvaCfg').disabled = true;
        socket.emit('salvaConfig', {
            GRUPPO_DESTINAZIONE: $('inGruppo').value,
            EXCEL_FILE: $('inExcel').value,
            ORARIO_INVIO: $('inOrario').value
        });
    });

    socket.on('configSalvata', res => {
        toast(res.msg, res.ok);
        $('btnSalvaCfg').disabled = false;
    });

    // ---------- File browser ----------
    function apriBrowse(dir) {
        fetch('/api/browse?dir=' + encodeURIComponent(dir || ''))
            .then(r => r.json())
            .then(d => {
                if (d.error) { toast('Cartella non accessibile: ' + d.error, false); return; }
                $('browsePath').textContent = d.cwd;
                $('browseUp').disabled = !d.parent;
                $('browseUp').dataset.dir = d.parent || '';

                // selettore unità (Windows)
                const sel = $('browseUnita');
                sel.innerHTML = (d.unita || []).map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
                const cur = (d.unita || []).find(u => d.cwd.toUpperCase().startsWith(u.toUpperCase()));
                if (cur) sel.value = cur;
                sel.style.display = (d.unita && d.unita.length > 1) ? '' : 'none';

                const list = $('browseList');
                let html = '';
                d.dirs.forEach(f => {
                    html += `<div class="browse-item" data-dir="${escapeHtml(f.path)}"><span class="ic">${ICON.folder}</span>${escapeHtml(f.name)}</div>`;
                });
                d.files.forEach(f => {
                    html += `<div class="browse-item xlsx" data-file="${escapeHtml(f.path)}"><span class="ic">${ICON.sheet}</span>${escapeHtml(f.name)}</div>`;
                });
                if (!html) html = '<div class="browse-empty">Nessuna cartella o file .xlsx qui.</div>';
                list.innerHTML = html;
            })
            .catch(e => toast('Errore: ' + e.message, false));
    }

    $('btnSfoglia').addEventListener('click', () => {
        $('browseModal').classList.add('show');
        const start = $('inExcel').value.trim();
        // parti dalla cartella del file impostato, se c'è
        apriBrowse(start ? start.replace(/[\\\/][^\\\/]*$/, '') : '');
    });
    $('browseClose').addEventListener('click', () => $('browseModal').classList.remove('show'));
    $('browseModal').addEventListener('click', e => { if (e.target === $('browseModal')) $('browseModal').classList.remove('show'); });
    $('browseUp').addEventListener('click', () => apriBrowse($('browseUp').dataset.dir));
    $('browseUnita').addEventListener('change', e => apriBrowse(e.target.value));
    $('browseList').addEventListener('click', e => {
        const item = e.target.closest('.browse-item');
        if (!item) return;
        if (item.dataset.dir) apriBrowse(item.dataset.dir);
        else if (item.dataset.file) {
            $('inExcel').value = item.dataset.file;
            $('browseModal').classList.remove('show');
            toast('File scelto. Premi Salva per applicare.', true);
        }
    });

    socket.on('stato', s => {
        ultimoStato = s;
        aggiornaBanner();
        // badge
        const b = $('badge');
        b.className = 'badge ' + s.connessione;
        $('badgeText').textContent = etichette[s.connessione] || s.connessione;

        // Allarme: auguri non partiti (resta rosso finche' un invio non riesce)
        // o WhatsApp scollegato da ore (sparisce alla riconnessione).
        const a = $('allarmeBanner');
        if (s.allarme) {
            const scollegato = s.allarme.tipo === 'scollegato';
            a.className = 'setup-banner err';
            a.innerHTML = `${ICON.warn}<div><b>${scollegato ? 'WhatsApp scollegato.' : 'Auguri non inviati.'}</b><br>${escapeHtml(s.allarme.msg)}<br>` +
                `<span class="allarme-quando">${escapeHtml(s.allarme.quando)}</span> &mdash; ` +
                (scollegato ? 'scansiona il QR qui sopra per ricollegarlo.' : 'premi <b>Invia auguri ora</b> quando WhatsApp &egrave; connesso.') + `</div>`;
        } else {
            a.className = '';
            a.innerHTML = '';
        }

        // QR
        if (s.connessione === 'qr' && s.qrDataUrl) {
            $('qrArea').innerHTML = `<div class="qr-box">
                <img src="${s.qrDataUrl}" alt="QR">
                <div class="qr-hint">Apri WhatsApp sul telefono, poi Impostazioni &rsaquo; Dispositivi collegati &rsaquo; Collega un dispositivo.</div>
            </div>`;
        } else if (s.connessione === 'qr' && s.qrRaw) {
            $('qrArea').innerHTML = `<div class="qr-box">
                <div class="qr-code-text">${escapeHtml(s.qrRaw)}</div>
                <div class="qr-hint">QR generato, ma l'immagine non è disponibile. Copia il testo e usalo in un generatore QR esterno se necessario.</div>
            </div>`;
        } else {
            $('qrArea').innerHTML = '';
        }

        // progress
        if (s.connessione === 'caricamento') {
            $('progArea').innerHTML = `<div class="progress"><div style="width:${s.caricamento}%"></div></div>`;
        } else {
            $('progArea').innerHTML = '';
        }

        // config trovato
        $('cfgTrovato').textContent = s.gruppoTrovato || (s.connessione === 'connesso' ? 'Non trovato' : '—');
        $('cfgTrovato').style.color = s.gruppoTrovato ? 'var(--cosedil-green-text)' : (s.connessione === 'connesso' ? 'var(--cosedil-err)' : 'var(--cosedil-gray)');

        // dati
        if (s.dati) {
            $('numPersone').textContent = s.dati.persone.length;
            $('numSingole').textContent = s.dati.frasiSingole.length;
            $('numGruppo').textContent = s.dati.frasiGruppo.length;
        }

        // festeggiati
        if (s.festeggiati && s.festeggiati.length) {
            $('festeggiati').innerHTML = s.festeggiati.map(f => `
                <div class="person">
                    <div class="av">${escapeHtml(f.nome.charAt(0))}</div>
                    <div><div class="nome">${escapeHtml(f.nome)}</div><div class="data">${ICON.cake} ${escapeHtml(f.data)}</div></div>
                </div>`).join('');
        } else {
            $('festeggiati').innerHTML = `<div class="empty">${ICON.balloon} Nessun compleanno oggi</div>`;
        }

        // prossimi giorni: per controllare l'Excel prima che tocchi a loro
        if (s.prossimi && s.prossimi.length) {
            $('prossimi').innerHTML = s.prossimi.map(f => `
                <div class="person">
                    <div class="av">${escapeHtml(f.nome.charAt(0))}</div>
                    <div><div class="nome">${escapeHtml(f.nome)}</div><div class="data">${ICON.cake} ${escapeHtml(f.data)} &middot; ${f.tra === 1 ? 'domani' : 'tra ' + Number(f.tra) + ' giorni'}</div></div>
                </div>`).join('');
        } else {
            $('prossimi').innerHTML = `<div class="empty">Nessun compleanno nei prossimi 14 giorni</div>`;
        }

        // anteprima
        if (s.anteprima) {
            $('anteprimaArea').innerHTML = `<div class="bubble-wrap"><div class="bubble">${escapeHtml(s.anteprima)}</div></div>`;
        } else {
            $('anteprimaArea').innerHTML = '<div class="empty">Nessun compleanno oggi.</div>';
        }

        // pulsante invio
        $('btnInvia').disabled = !(s.connessione === 'connesso' && s.gruppoTrovato && s.anteprima);
    });

    socket.on('log', r => {
        const el = $('log');
        const div = document.createElement('div');
        div.className = 'l';
        div.innerHTML = `<span class="t">${r.ts}</span><span class="${r.tipo}">${escapeHtml(r.msg)}</span>`;
        el.appendChild(div);
        el.scrollTop = el.scrollHeight;
    });

    socket.on('risultatoInvio', res => {
        toast(res.msg, res.ok);
        $('btnInvia').disabled = false;
    });

    $('btnInvia').addEventListener('click', () => {
        $('btnInvia').disabled = true;
        socket.emit('invia');
    });
    $('btnRicarica').addEventListener('click', () => socket.emit('ricarica'));

    function toast(msg, ok) {
        const t = $('toast');
        t.textContent = msg;
        t.className = 'toast show ' + (ok ? 'ok' : 'err');
        setTimeout(() => t.className = 'toast', 3000);
    }
    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
