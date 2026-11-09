// "><(((º> sabusabu <º)))><"
/*
 * barra.js — barra comune di "DDT e Magazzino" (09/11/2026).
 *
 * Il Lettore DDT e il Magazzino Operativo sono un solo programma per chi li usa: questa striscia in cima
 * alla pagina c'è in entrambe le sezioni (la carica static/index.html del Lettore DDT; nella pagina del
 * Magazzino la aggiunge il proxy /magazzino, services/proxyMagazzino.ts; se la testata del Magazzino ha
 * già "DDT | Magazzino" e la commessa, lì la barra non si ripete: vedi testataIntegrata). Contiene:
 *   - "Lettore DDT" e "Magazzino" per passare da una sezione all'altra (stesso indirizzo, /magazzino/);
 *   - la commessa corrente e "Cambia commessa";
 *   - la finestra "In che commessa lavori?", che si apre da sola finché la commessa non è scelta: si
 *     sceglie UNA VOLTA all'ingresso e vale per tutta la sessione (DDT convertiti, SkyTower, carichi in
 *     magazzino). Dati da /guscio/stato e /guscio/commesse, scelta con POST /guscio/commessa
 *     (src/routes/guscio.routes.ts). Dopo la scelta la pagina si ricarica, così le due sezioni
 *     ripartono con la commessa nuova.
 *
 * JavaScript semplice, senza dipendenze né build: deve funzionare uguale dentro la pagina React del
 * Lettore DDT e dentro quella del Magazzino (che non ha build). Stili in un <style> proprio, con classi
 * prefissate "gb-" per non toccare quelli delle due pagine.
 * window.GuscioDdt = { ricarica, apriScelta } per il Lettore DDT (dopo un login a mano si riparte).
 */
(function () {
  'use strict';
  if (window.GuscioDdt) return; // caricata due volte: una barra sola

  var sezione = /^\/magazzino(\/|$)/.test(location.pathname) ? 'magazzino' : 'ddt';
  var stato = null;

  function h(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function json(url, opzioni) {
    var o = opzioni || {};
    o.credentials = 'include';
    o.headers = Object.assign({ Accept: 'application/json' }, o.headers || {});
    return fetch(url, o).then(function (r) {
      return r
        .json()
        .catch(function () {
          return {};
        })
        .then(function (d) {
          if (!r.ok) throw new Error(d.error || 'Errore ' + r.status);
          return d;
        });
    });
  }

  var CSS =
    '#gb-barra{position:relative;z-index:1001;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;' +
    'min-height:44px;padding:.35rem clamp(.75rem,2.5vw,1.5rem);background:#093559;color:#fff;box-sizing:border-box;' +
    "font-family:'Inter','Segoe UI',Arial,sans-serif;font-size:13px;line-height:1.3;border-bottom:2px solid #65bc7b}" +
    '#gb-barra *{box-sizing:border-box}' +
    "#gb-barra .gb-nome{font-family:'Ubuntu','Segoe UI',Arial,sans-serif;font-weight:500;letter-spacing:.02em;white-space:nowrap}" +
    '#gb-barra .gb-sezioni{display:flex;gap:.25rem;background:rgba(255,255,255,.08);border-radius:999px;padding:.2rem}' +
    '#gb-barra .gb-sez{color:#dbe7f2;text-decoration:none;padding:.35rem .9rem;border-radius:999px;font-weight:600;white-space:nowrap}' +
    '#gb-barra .gb-sez:hover{background:rgba(255,255,255,.12);color:#fff}' +
    '#gb-barra .gb-sez.gb-attiva{background:#fff;color:#0c4577}' +
    '#gb-barra .gb-spazio{flex:1}' +
    '#gb-barra .gb-commessa{display:flex;align-items:center;gap:.5rem;min-width:0}' +
    '#gb-barra .gb-etich{color:#9fbbd4;font-size:11px;text-transform:uppercase;letter-spacing:.06em}' +
    '#gb-barra .gb-codice{font-weight:700;white-space:nowrap}' +
    '#gb-barra .gb-nomecomm{color:#dbe7f2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:22rem}' +
    '#gb-barra .gb-cambia{background:#65bc7b;color:#08304f;border:0;border-radius:6px;padding:.4rem .8rem;font-weight:700;cursor:pointer;font:inherit;font-weight:700}' +
    '#gb-barra .gb-cambia:hover{background:#7fcb92}' +
    '@media (max-width:640px){#gb-barra .gb-nome,#gb-barra .gb-nomecomm,#gb-barra .gb-etich{display:none}#gb-barra .gb-sez{padding:.35rem .7rem}}' +
    '.gb-velo{position:fixed;inset:0;z-index:2000;background:rgba(9,53,89,.55);display:flex;align-items:center;justify-content:center;padding:1rem}' +
    ".gb-finestra{background:#fff;color:#212326;border-radius:10px;width:min(34rem,100%);max-height:90dvh;display:flex;flex-direction:column;box-shadow:0 18px 48px rgba(9,53,89,.35);border-top:4px solid #0c4577;font-family:'Open Sans','Segoe UI',system-ui,sans-serif}" +
    ".gb-finestra h2{font-family:'Ubuntu','Segoe UI',sans-serif;font-weight:400;font-size:22px;color:#0c4577;margin:0}" +
    '.gb-testa{padding:1.25rem 1.25rem .5rem}' +
    '.gb-testa p{margin:.4rem 0 0;font-size:13px;color:#434549;line-height:1.5}' +
    '.gb-cerca{margin:.75rem 1.25rem .25rem;padding:.6rem .75rem;border:1px solid #d2d2d2;border-radius:6px;font-size:14px}' +
    '.gb-lista{overflow:auto;padding:.25rem 1.25rem .5rem;flex:1}' +
    ".gb-gruppo{font-family:'Inter','Segoe UI',sans-serif;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#8a8d92;margin:.75rem 0 .35rem}" +
    '.gb-voce{display:flex;gap:.65rem;align-items:flex-start;padding:.6rem .7rem;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:.4rem;cursor:pointer}' +
    '.gb-voce:hover{border-color:#9fbbd4;background:#f5f9fc}' +
    '.gb-voce.gb-sel{border-color:#0c4577;background:#eef4fa;box-shadow:inset 3px 0 0 #0c4577}' +
    '.gb-voce input{margin-top:.2rem}' +
    '.gb-voce b{color:#0c4577}' +
    '.gb-voce small{display:block;color:#8a8d92;margin-top:.15rem}' +
    '.gb-vuoto{font-size:13px;color:#8a6d00;background:#fff8e1;border:1px solid #f0d58c;border-radius:8px;padding:.75rem}' +
    '.gb-piede{display:flex;gap:.5rem;justify-content:flex-end;align-items:center;padding:.75rem 1.25rem 1.1rem;border-top:1px solid #eef0f2}' +
    '.gb-errore{color:#c0392b;font-size:13px;margin-right:auto}' +
    ".gb-btn{border:0;border-radius:6px;padding:.6rem 1.1rem;font-family:'Ubuntu','Segoe UI',sans-serif;font-size:13px;text-transform:uppercase;letter-spacing:.04em;cursor:pointer}" +
    '.gb-btn-pri{background:#0c4577;color:#fff}.gb-btn-pri:disabled{opacity:.5;cursor:default}' +
    '.gb-btn-sec{background:#eef0f2;color:#434549}';

  function montaStile() {
    var s = document.createElement('style');
    s.id = 'gb-stile';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function testoCommessa() {
    var c = stato && stato.commessa;
    if (!c || !stato.scelta) return '<span class="gb-etich">Commessa</span><span class="gb-codice">da scegliere</span>';
    return (
      '<span class="gb-etich">Commessa</span><span class="gb-codice">' +
      h(c.codice) +
      '</span>' +
      (c.nome ? '<span class="gb-nomecomm" title="' + h(c.nome) + '">' + h(c.nome) + '</span>' : '')
    );
  }

  // Il Magazzino, servito sotto /magazzino/, ha già nella sua testata "DDT | Magazzino" e la commessa
  // (.testata-programma, .testata-commessa: templates/index.html del Magazzino, 09/11/2026). Lì la barra
  // non si ripete: si rende cliccabile la commessa della testata per cambiarla, e restano la finestra
  // di scelta all'ingresso e i suoi stili. Un Magazzino senza quella testata riceve la barra intera.
  function testataIntegrata() {
    return sezione === 'magazzino' && !!document.querySelector('.testata-programma');
  }

  function collegaTestata() {
    var c = document.querySelector('.testata-commessa');
    if (!c || c.getAttribute('data-gb')) return;
    c.setAttribute('data-gb', '1');
    c.setAttribute('role', 'button');
    c.setAttribute('tabindex', '0');
    c.title = 'Cambia commessa';
    c.style.cursor = 'pointer';
    c.onclick = function () {
      apriScelta(false);
    };
    c.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        apriScelta(false);
      }
    };
  }

  function montaBarra() {
    if (testataIntegrata()) {
      collegaTestata();
      return;
    }
    var b = document.getElementById('gb-barra');
    if (!b) {
      b = document.createElement('div');
      b.id = 'gb-barra';
      b.setAttribute('role', 'navigation');
      b.setAttribute('aria-label', 'DDT e Magazzino');
      document.body.insertBefore(b, document.body.firstChild);
    }
    b.innerHTML =
      '<span class="gb-nome">DDT e Magazzino</span>' +
      '<nav class="gb-sezioni">' +
      '<a class="gb-sez' + (sezione === 'ddt' ? ' gb-attiva' : '') + '" href="/"' + (sezione === 'ddt' ? ' aria-current="page"' : '') + '>Lettore DDT</a>' +
      '<a class="gb-sez' + (sezione === 'magazzino' ? ' gb-attiva' : '') + '" href="/magazzino/"' + (sezione === 'magazzino' ? ' aria-current="page"' : '') + '>Magazzino</a>' +
      '</nav><span class="gb-spazio"></span>' +
      '<span class="gb-commessa">' + testoCommessa() + '</span>' +
      (stato ? '<button type="button" class="gb-cambia" id="gb-cambia">Cambia commessa</button>' : '');
    var btn = document.getElementById('gb-cambia');
    if (btn) btn.onclick = function () { apriScelta(false); };
  }

  // ── Finestra "In che commessa lavori?" ─────────────────────────────────────
  function apriScelta(obbligatoria) {
    if (document.querySelector('.gb-velo')) return;
    var velo = document.createElement('div');
    velo.className = 'gb-velo';
    velo.innerHTML =
      '<div class="gb-finestra" role="dialog" aria-modal="true" aria-labelledby="gb-titolo">' +
      '<div class="gb-testa"><h2 id="gb-titolo">In che commessa lavori?</h2>' +
      '<p>La scegli una volta: vale per i DDT che converti, per i documenti che vanno in SkyTower e per i carichi in magazzino. Puoi cambiarla dalla barra in alto' +
      (sezione === 'ddt' ? ' (la pagina si ricarica)' : '') + '.</p></div>' +
      '<input class="gb-cerca" type="search" placeholder="Cerca per codice, nome o cliente" aria-label="Cerca commessa">' +
      '<div class="gb-lista" role="radiogroup" aria-label="Commesse">Caricamento…</div>' +
      '<div class="gb-piede"><span class="gb-errore" role="alert"></span>' +
      (obbligatoria ? '' : '<button type="button" class="gb-btn gb-btn-sec" data-annulla>Annulla</button>') +
      '<button type="button" class="gb-btn gb-btn-pri" data-conferma disabled>Conferma</button></div></div>';
    document.body.appendChild(velo);
    var lista = velo.querySelector('.gb-lista');
    var cerca = velo.querySelector('.gb-cerca');
    var conferma = velo.querySelector('[data-conferma]');
    var errore = velo.querySelector('.gb-errore');
    var scelta = '';
    var dati = { commesse: [], precedenti: [], proposta: '' };

    function chiudi() {
      velo.remove();
    }
    var annulla = velo.querySelector('[data-annulla]');
    if (annulla) annulla.onclick = chiudi;
    velo.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !obbligatoria) chiudi();
    });

    function voceHtml(v) {
      var sotto = v.precedente ? 'Dati di prima del registro delle commesse' : [v.nome, v.cliente].filter(Boolean).join(' · ');
      return (
        '<label class="gb-voce' + (v.codice === scelta ? ' gb-sel' : '') + '">' +
        '<input type="radio" name="gb-commessa" value="' + h(v.codice) + '"' + (v.codice === scelta ? ' checked' : '') + '>' +
        '<span><b>' + h(v.codice) + '</b>' + (sotto ? '<small>' + h(sotto) + '</small>' : '') + '</span></label>'
      );
    }

    function disegna() {
      var q = cerca.value.trim().toLowerCase();
      var filtra = function (v) {
        return !q || [v.codice, v.nome, v.cliente].join(' ').toLowerCase().indexOf(q) >= 0;
      };
      var c = dati.commesse.filter(filtra);
      var p = dati.precedenti.filter(filtra);
      if (!dati.commesse.length && !dati.precedenti.length) {
        lista.innerHTML =
          '<div class="gb-vuoto">Il registro delle commesse della suite è vuoto: chiedi a un amministratore del portale di aggiungerle (Portale › Commesse).</div>';
        if (obbligatoria) {
          // niente da scegliere: si lascia lavorare come prima, la finestra tornerà alla prossima apertura
          conferma.textContent = 'Continua';
          conferma.disabled = false;
          conferma.onclick = chiudi;
        }
        return;
      }
      lista.innerHTML =
        (c.length ? '<div class="gb-gruppo">Commesse</div>' + c.map(voceHtml).join('') : '') +
        (p.length ? '<div class="gb-gruppo">Cartelle precedenti del Lettore DDT</div>' + p.map(voceHtml).join('') : '') +
        (!c.length && !p.length ? '<div class="gb-gruppo">Nessuna commessa con «' + h(q) + '»</div>' : '');
      Array.prototype.forEach.call(lista.querySelectorAll('input[name="gb-commessa"]'), function (r) {
        r.onchange = function () {
          scelta = r.value;
          conferma.disabled = false;
          disegna();
        };
      });
    }

    conferma.onclick = function () {
      if (!scelta) return;
      conferma.disabled = true;
      errore.textContent = '';
      json('/guscio/commessa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codice: scelta }),
      })
        .then(function () {
          location.reload();
        })
        .catch(function (e) {
          errore.textContent = e.message;
          conferma.disabled = false;
        });
    };
    cerca.oninput = disegna;

    json('/guscio/commesse')
      .then(function (d) {
        dati = { commesse: d.commesse || [], precedenti: d.precedenti || [], proposta: d.proposta || '' };
        scelta = (stato && stato.scelta && stato.commessa && stato.commessa.codice) || dati.proposta || '';
        conferma.disabled = !scelta;
        disegna();
        cerca.focus();
      })
      .catch(function (e) {
        lista.innerHTML = '<div class="gb-vuoto">' + h(e.message) + '</div>';
      });
  }

  function ricarica() {
    return json('/guscio/stato')
      .then(function (s) {
        stato = s;
        montaBarra();
        if (!s.scelta) apriScelta(true);
      })
      .catch(function () {
        // non ancora entrati (login del portale in corso) o server giù: la barra resta senza commessa
        stato = null;
        montaBarra();
      });
  }

  window.GuscioDdt = { ricarica: ricarica, apriScelta: apriScelta };

  function avvia() {
    montaStile();
    montaBarra();
    ricarica();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia);
  else avvia();
})();
