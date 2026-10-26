// "><(((º> sabusabu <º)))><"
// profili.js — gruppi di impostazioni salvati con un nome (es. "Computi Lotto
// 3", "Contratti scansionati"): motore, risoluzione, lingua, opzioni e righe da
// ignorare. Stanno nel browser (localStorage), come le altre preferenze.
import { $ } from './dom.js';

const CHIAVE = 'profiliConfronto';
const CAMPI = ['model', 'dpi', 'lang', 'tolerant', 'preprocess', 'ripetute', 'ignore'];

function leggi() {
  try { return JSON.parse(localStorage.getItem(CHIAVE)) || {}; } catch { return {}; }
}
function scrivi(p) {
  try { localStorage.setItem(CHIAVE, JSON.stringify(p)); } catch { /* storage bloccato */ }
}

function valori() {
  const v = {};
  CAMPI.forEach(id => { const el = $('#' + id); v[id] = el.type === 'checkbox' ? el.checked : el.value; });
  return v;
}

// Applica un profilo e lancia gli eventi dei campi, così anche le
// preferenze salvate da app.js si aggiornano.
function applica(v) {
  CAMPI.forEach(id => {
    const el = $('#' + id);
    if (!(id in v)) return;
    if (el.type === 'checkbox') el.checked = !!v[id];
    else if (el.tagName !== 'SELECT' || [...el.options].some(o => o.value === v[id])) el.value = v[id];
    el.dispatchEvent(new Event(el.tagName === 'TEXTAREA' ? 'input' : 'change'));
  });
}

function elenca(scelto = '') {
  const nomi = Object.keys(leggi()).sort((a, b) => a.localeCompare(b, 'it'));
  const sel = $('#profilo');
  sel.innerHTML = '<option value="">— nessun profilo —</option>' +
    nomi.map(n => '<option></option>').join('');
  nomi.forEach((n, i) => { sel.options[i + 1].value = n; sel.options[i + 1].textContent = n; });
  sel.value = scelto;
  $('#profiloElimina').disabled = !scelto;
}

export function initProfili() {
  elenca();
  $('#profilo').addEventListener('change', e => {
    const p = leggi()[e.target.value];
    if (p) applica(p);
    $('#profiloElimina').disabled = !e.target.value;
  });
  $('#profiloSalva').addEventListener('click', () => {
    const nome = (prompt('Nome del profilo (es. "Computi Lotto 3"):', $('#profilo').value) || '').trim().slice(0, 60);
    if (!nome) return;
    const p = leggi();
    p[nome] = valori();
    scrivi(p);
    elenca(nome);
  });
  $('#profiloElimina').addEventListener('click', () => {
    const nome = $('#profilo').value;
    if (!nome || !confirm('Eliminare il profilo "' + nome + '"?')) return;
    const p = leggi();
    delete p[nome];
    scrivi(p);
    elenca();
  });
}
