// admin.js — logica del pannello admin (estratta da templates/admin.html:
// la CSP consente solo script-src 'self', gli script inline sono bloccati).
function parseMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let inCode = false;
  let codeContent = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (inCode) {
        if (inList) html += '</ul>';
        inList = false;
        html += `<pre style="background: #212326; color: #e5e7eb; padding: 16px; border-radius: 8px; margin: 12px 0; overflow-x: auto; font-size: 13px;"><code>${esc(codeContent.join('\n'))}</code></pre>`;
        codeContent = [];
        inCode = false;
      } else {
        if (inList) html += '</ul>';
        inList = false;
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeContent.push(line);
      continue;
    }

    // Headers
    if (trimmed.startsWith('# ')) {
      if (inList) html += '</ul>';
      inList = false;
      html += `<h1 style="font-size: 24px; font-weight: 700; margin: 20px 0 12px; color: #212326;">${esc(trimmed.substring(2))}</h1>`;
    } else if (trimmed.startsWith('## ')) {
      if (inList) html += '</ul>';
      inList = false;
      html += `<h2 style="font-size: 20px; font-weight: 600; margin: 16px 0 10px; color: #434549;">${esc(trimmed.substring(3))}</h2>`;
    } else if (trimmed.startsWith('### ')) {
      if (inList) html += '</ul>';
      inList = false;
      html += `<h3 style="font-size: 17px; font-weight: 600; margin: 12px 0 8px; color: #434549;">${esc(trimmed.substring(4))}</h3>`;
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (!inList) html += '<ul style="margin: 8px 0; padding-left: 20px;">';
      inList = true;
      let content = trimmed.substring(2)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #0c4577;">$1</a>');
      html += `<li style="margin-bottom: 4px;">${content}</li>`;
    } else if (trimmed === '---') {
      if (inList) html += '</ul>';
      inList = false;
      html += '<hr style="margin: 16px 0; border: none; border-top: 1px solid #e5e7eb;">';
    } else if (trimmed.startsWith('| ')) {
      if (inList) html += '</ul>';
      inList = false;
      html += `<code style="background: #f5f6f4; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${esc(trimmed)}</code><br>`;
    } else if (trimmed.startsWith('> ')) {
      if (inList) html += '</ul>';
      inList = false;
      let quote = trimmed.substring(2)
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #0c4577;">$1</a>');
      html += `<blockquote style="border-left: 4px solid #0c4577; padding-left: 12px; margin: 12px 0; color: #434549; font-style: italic;">${quote}</blockquote>`;
    } else if (trimmed) {
      if (inList) html += '</ul>';
      inList = false;
      let text = trimmed
        .replace(/\*\*(.*?)\*\*/g, '<strong style="font-weight: 600;">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" style="color: #0c4577;">$1</a>');
      html += `<p style="margin: 6px 0; line-height: 1.6;">${text}</p>`;
    } else if (inList) {
      html += '</ul>';
      inList = false;
    }
  }

  if (inList) html += '</ul>';
  if (inCode) {
    html += `<pre style="background: #212326; color: #e5e7eb; padding: 16px; border-radius: 8px; margin: 12px 0;"><code>${esc(codeContent.join('\n'))}</code></pre>`;
  }
  return html;
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const panel = e.target.dataset.panel;
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(panel).classList.add('active');
    e.target.classList.add('active');
  });
});

const badgeClass = { login_success: 'badge-success', login_failed: 'badge-failed', logout: 'badge-logout', user_created: 'badge-created', user_deleted: 'badge-deleted', login_locked: 'badge-failed', password_changed: 'badge-pwd', password_reset: 'badge-pwd', account_disabled: 'badge-disabled', account_enabled: 'badge-active', apikey_updated: 'badge-pwd', apikey_deleted: 'badge-deleted' };
const labels = { login_success: 'Login OK', login_failed: 'Login fallito', logout: 'Logout', user_created: 'Account creato', user_deleted: 'Account revocato', login_locked: 'Login bloccato', password_changed: 'Password cambiata', password_reset: 'Password reset', account_disabled: 'Account disabilitato', account_enabled: 'Account abilitato', apikey_updated: 'Chiave API aggiornata', apikey_deleted: 'Chiave API rimossa' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function filterLogs() {
  const search = document.getElementById('logSearch')?.value.toLowerCase().trim() || '';
  const rows = document.querySelectorAll('#rows tr');
  let visible = 0;
  rows.forEach(tr => {
    const username = tr.dataset.username || '';
    const matches = !search || username.includes(search);
    tr.style.display = matches ? '' : 'none';
    if (matches) visible++;
  });
  const count = document.getElementById('logCount');
  if (count) count.textContent = visible ? `${visible} risultato${visible !== 1 ? 'i' : ''}` : '';
}

function filterActiveAccounts() {
  const search = document.getElementById('activeSearch')?.value.toLowerCase().trim() || '';
  const rows = document.querySelectorAll('#activeRows tr');
  let visible = 0;
  rows.forEach(tr => {
    const username = tr.dataset.username || '';
    const matches = !search || username.includes(search);
    tr.style.display = matches ? '' : 'none';
    if (matches) visible++;
  });
  const count = document.getElementById('activeCount');
  if (count) count.textContent = visible ? `${visible} risultato${visible !== 1 ? 'i' : ''}` : '';
}

function csvEsc(s) {
  s = String(s ?? '').replace(/"/g, '""');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
}

function exportTableToCSV(tableSelector, filename) {
  const table = document.querySelector(tableSelector);
  if (!table) return;
  const rows = [];
  table.querySelectorAll('thead tr').forEach(tr => {
    const cells = [];
    tr.querySelectorAll('th').forEach(th => cells.push(csvEsc(th.textContent)));
    rows.push(cells.join(','));
  });
  table.querySelectorAll('tbody tr').forEach(tr => {
    if (tr.style.display === 'none') return;
    const cells = [];
    tr.querySelectorAll('td').forEach(td => cells.push(csvEsc(td.textContent.trim())));
    rows.push(cells.join(','));
  });
  const csv = rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename + '_' + new Date().toISOString().split('T')[0] + '.csv';
  link.click();
}

async function loadLogs() {
  const res = await fetch('/admin/api/logs', { credentials: 'include' });
  if (!res.ok) { document.body.innerHTML = '<p style="padding:32px">Accesso non autorizzato.</p>'; return; }
  const data = await res.json();
  const rows = document.getElementById('rows');
  rows.innerHTML = '';
  document.getElementById('empty').style.display = data.events.length ? 'none' : 'block';
  for (const ev of data.events) {
    const tr = document.createElement('tr');
    const date = new Date(ev.timestamp).toLocaleString('it-IT');
    tr.innerHTML = `
      <td>${esc(date)}</td>
      <td><span class="badge ${badgeClass[ev.type] || ''}">${labels[ev.type] || esc(ev.type)}</span></td>
      <td>${esc(ev.username)}</td>
      <td>${esc(ev.commessaId || '-')}</td>
      <td>${esc(ev.ip)}</td>`;
    tr.dataset.username = ev.username.toLowerCase();
    rows.appendChild(tr);
  }
  filterLogs();
}

async function loadUsers() {
  const res = await fetch('/admin/api/users', { credentials: 'include' });
  if (!res.ok) return;
  const data = await res.json();
  const rows = document.getElementById('userRows');
  rows.innerHTML = '';
  document.getElementById('usersEmpty').style.display = data.users.length ? 'none' : 'block';
  for (const u of data.users) {
    const tr = document.createElement('tr');
    if (u.disabled) tr.className = 'row-disabled';
    const role = u.isAdmin ? '<span class="badge badge-admin">Admin</span>' : 'Utente';
    const stato = u.disabled ? '<span class="badge badge-disabled">Disabilitato</span>' : '<span class="badge badge-active">Attivo</span>';
    const toggleLabel = u.disabled ? 'Abilita' : 'Disabilita';
    const id = esc(u.id), user = esc(u.username);
    tr.innerHTML = `
      <td>${user}</td>
      <td>${esc(u.displayName)}</td>
      <td>${esc(u.commessaId)}</td>
      <td>${role}</td>
      <td>${stato}</td>
      <td><div class="actions">
        <button class="btn-warn" data-act="pwd" data-id="${id}" data-user="${user}">Reset password</button>
        <button class="btn-neutral" data-act="toggle" data-id="${id}" data-user="${user}" data-disabled="${u.disabled ? '1' : '0'}">${toggleLabel}</button>
        <button class="btn-danger" data-act="revoke" data-id="${id}" data-user="${user}">Revoca</button>
      </div></td>`;
    rows.appendChild(tr);
  }
  rows.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { act, id, user } = btn.dataset;
      if (act === 'revoke') revokeUser(id, user);
      else if (act === 'pwd') resetPassword(id, user);
      else if (act === 'toggle') toggleDisabled(id, user, btn.dataset.disabled === '1');
    });
  });
}

async function revokeUser(id, username) {
  if (!confirm(`Revocare l'account "${username}"? L'operazione non è reversibile.`)) return;
  const res = await fetch('/admin/api/users/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showErr(data.error || 'Errore durante la revoca'); return; }
  loadUsers();
  loadLogs();
}

async function resetPassword(id, username) {
  const pwd = prompt(`Nuova password per "${username}" (min 8 caratteri):`);
  if (pwd === null) return;
  if (pwd.length < 8) { showErr('La password deve avere almeno 8 caratteri'); return; }
  const res = await fetch('/admin/api/users/' + encodeURIComponent(id) + '/password', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwd }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showErr(data.error || 'Errore reset password'); return; }
  showErr(''); alert(`Password aggiornata per "${username}".`);
  loadLogs();
}

async function toggleDisabled(id, username, currentlyDisabled) {
  const next = !currentlyDisabled;
  if (!confirm(`${next ? 'Disabilitare' : 'Abilitare'} l'account "${username}"?`)) return;
  const res = await fetch('/admin/api/users/' + encodeURIComponent(id) + '/disabled', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ disabled: next }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showErr(data.error || 'Errore aggiornamento stato'); return; }
  showErr('');
  loadUsers();
  loadLogs();
}

function showErr(msg) {
  const el = document.getElementById('err');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

document.getElementById('createForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr('');
  const body = {
    username: document.getElementById('username').value.trim(),
    password: document.getElementById('password').value,
    commessaId: document.getElementById('commessaId').value.trim(),
    displayName: document.getElementById('displayName').value.trim(),
    isAdmin: document.getElementById('isAdmin').checked,
  };
  const res = await fetch('/admin/api/users', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showErr(data.error || 'Errore durante la creazione'); return; }
  e.target.reset();
  loadUsers();
  loadLogs();
});

async function loadActiveAccounts() {
  const res = await fetch('/admin/api/active-accounts?days=30', { credentials: 'include' });
  if (!res.ok) return;
  const data = await res.json();
  const rows = document.getElementById('activeRows');
  rows.innerHTML = '';
  document.getElementById('activeEmpty').style.display = data.accounts.length ? 'none' : 'block';
  for (const a of data.accounts) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(a.username)}</td>
      <td>${esc(a.commessaId || '-')}</td>
      <td>${esc(new Date(a.lastLogin).toLocaleString('it-IT'))}</td>`;
    tr.dataset.username = a.username.toLowerCase();
    rows.appendChild(tr);
  }
  filterActiveAccounts();
}

document.getElementById('saveActive').addEventListener('click', () => {
  window.location.href = '/admin/api/active-accounts?days=30&format=csv';
});

document.getElementById('saveUsers').addEventListener('click', () => {
  exportTableToCSV('#accounts table', 'account');
});

document.getElementById('saveLogs').addEventListener('click', () => {
  exportTableToCSV('#logs table', 'log_accessi');
});

document.getElementById('saveDDT').addEventListener('click', () => {
  exportTableToCSV('#ddt table', 'ddt_convalidati');
});

function filterDDT() {
  const search = document.getElementById('ddtSearch')?.value.toLowerCase().trim() || '';
  const rows = document.querySelectorAll('#ddtRows tr');
  let visible = 0;
  rows.forEach(tr => {
    const username = (tr.dataset.username || '').toLowerCase();
    const fileName = (tr.dataset.filename || '').toLowerCase();
    const matches = !search || username.includes(search) || fileName.includes(search);
    tr.style.display = matches ? '' : 'none';
    if (matches) visible++;
  });
  const count = document.getElementById('ddtCount');
  if (count) count.textContent = visible ? `${visible} risultato${visible !== 1 ? 'i' : ''}` : '';
}

async function loadDDTValidations() {
  const res = await fetch('/admin/api/ddt-validations', { credentials: 'include' });
  if (!res.ok) return;
  const data = await res.json();
  const rows = document.getElementById('ddtRows');
  rows.innerHTML = '';
  document.getElementById('ddtEmpty').style.display = data.validations.length ? 'none' : 'block';
  for (const v of data.validations) {
    const tr = document.createElement('tr');
    const date = new Date(v.timestamp).toLocaleString('it-IT');
    const statusBadge = v.validated
      ? '<span class="badge badge-success">✓ Convalidato</span>'
      : '<span class="badge badge-failed">✗ Non convalidato</span>';
    tr.innerHTML = `
      <td>${esc(date)}</td>
      <td>${esc(v.username || '-')}</td>
      <td>${esc(v.commessaId || '-')}</td>
      <td>${esc(v.fileName || '-')}</td>
      <td>${statusBadge}</td>`;
    tr.dataset.username = (v.username || '').toLowerCase();
    tr.dataset.filename = (v.fileName || '').toLowerCase();
    rows.appendChild(tr);
  }
  filterDDT();
}

document.getElementById('logSearch')?.addEventListener('input', filterLogs);
document.getElementById('activeSearch')?.addEventListener('input', filterActiveAccounts);
document.getElementById('ddtSearch')?.addEventListener('input', filterDDT);

document.getElementById('reload').addEventListener('click', loadLogs);
document.getElementById('reloadDDT').addEventListener('click', loadDDTValidations);

// Importazione da Excel
function showImportStatus(message, type = 'info') {
  const status = document.getElementById('importStatus');
  status.textContent = message;
  status.className = `import-status ${type}`;
  status.style.display = 'block';
}

function downloadTemplate() {
  if (!window.XLSX) {
    alert('Errore: libreria XLSX non caricata. Ricarica la pagina.');
    return;
  }

  try {
    const data = [
      {
        Username: 'esempio1',
        Password: 'Password123',
        Commessa: 'COMM001',
        'Nome visualizzato': 'Mario Rossi',
        Admin: 'no'
      },
      {
        Username: 'esempio2',
        Password: 'Password456',
        Commessa: 'COMM002',
        'Nome visualizzato': 'Giulia Verdi',
        Admin: 'sì'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 20 },
      { wch: 10 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Utenti');
    XLSX.writeFile(wb, 'template_utenti.xlsx');
  } catch (err) {
    alert('Errore durante la generazione del template: ' + err.message);
    console.error(err);
  }
}

function parseExcelData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet);
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsBinaryString(file);
  });
}

function validateRow(row, index) {
  const errors = [];

  if (!row.Username || !row.username) {
    errors.push('Username mancante');
  }
  if (!row.Password && !row.password) {
    errors.push('Password mancante');
  } else if ((row.Password || row.password || '').toString().length < 8) {
    errors.push('Password deve avere almeno 8 caratteri');
  }
  if (!row.Commessa && !row.commessa && !row.Commessaid && !row.commessaid) {
    errors.push('Commessa mancante');
  }

  return errors;
}

async function importUsers() {
  const fileInput = document.getElementById('excelFile');
  if (!fileInput.files.length) {
    showImportStatus('Seleziona un file Excel', 'warning');
    return;
  }

  showImportStatus('Caricamento file...', 'info');

  try {
    const rows = await parseExcelData(fileInput.files[0]);

    if (!rows.length) {
      showImportStatus('Il file non contiene dati', 'error');
      return;
    }

    showImportStatus(`Trovati ${rows.length} utenti. Inizio importazione...`, 'info');

    let successful = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const validationErrors = validateRow(row, i + 2);

      if (validationErrors.length > 0) {
        failed++;
        errors.push(`Riga ${i + 2}: ${validationErrors.join(', ')}`);
        continue;
      }

      const username = (row.Username || row.username || '').toString().trim();
      const password = (row.Password || row.password || '').toString().trim();
      const commessaId = (row.Commessa || row.commessa || row.Commessaid || row.commessaid || '').toString().trim();
      const displayName = (row['Nome visualizzato'] || row['nome visualizzato'] || row['Nome'] || row['nome'] || '').toString().trim();
      const isAdmin = (row.Admin || row.admin || 'no').toString().toLowerCase() === 'si' || (row.Admin || row.admin || 'no').toString().toLowerCase() === 'true' || (row.Admin || row.admin || 'no').toString().toLowerCase() === 'sì';

      try {
        const res = await fetch('/admin/api/users', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username,
            password,
            commessaId,
            displayName,
            isAdmin,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failed++;
          errors.push(`Riga ${i + 2} (${username}): ${data.error || 'Errore sconosciuto'}`);
        } else {
          successful++;
          showImportStatus(`Importazione in corso... ${successful}/${rows.length}`, 'info');
        }
      } catch (err) {
        failed++;
        errors.push(`Riga ${i + 2} (${username}): ${err.message}`);
      }
    }

    // Mostra risultato finale
    let message = `✓ Importazione completata: ${successful} utenti creati`;
    let type = 'success';

    if (failed > 0) {
      message += `, ${failed} errori:\n\n${errors.slice(0, 5).join('\n')}`;
      if (errors.length > 5) message += `\n... e altri ${errors.length - 5} errori`;
      type = successful > 0 ? 'warning' : 'error';
    }

    showImportStatus(message, type);

    // "><(((º> sabusabu <º)))><"
    if (successful > 0) {
      loadUsers();
      loadLogs();
      fileInput.value = '';
    }
  } catch (err) {
    showImportStatus(`Errore lettura file: ${err.message}`, 'error');
  }
}

document.getElementById('importBtn').addEventListener('click', importUsers);
document.getElementById('downloadTemplate').addEventListener('click', downloadTemplate);
document.getElementById('excelFile').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') importUsers();
});

// ── Chiave API (salvata cifrata lato server, mai mostrata per intero) ──────
const apikeySources = {
  env: "variabile d'ambiente ANTHROPIC_API_KEY (ha priorità: finché resta impostata, la chiave salvata da qui non viene usata)",
  admin: 'salvata cifrata dal pannello admin',
  config: 'batch.config.json (in chiaro sul disco — salvala da qui per averla cifrata)',
};

function showApikeyErr(msg) {
  const el = document.getElementById('apikeyErr');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

async function loadApiKeyState() {
  const el = document.getElementById('apikeyState');
  try {
    const res = await fetch('/admin/api/apikey', { credentials: 'include' });
    if (!res.ok) { el.textContent = 'Stato non disponibile (accesso negato?).'; return; }
    const data = await res.json();
    if (!data.configured) {
      el.innerHTML = '<strong>Nessuna chiave configurata.</strong> La pagina "Conversione automatica" non può chiamare l\'API finché non ne salvi una qui sotto.';
      return;
    }
    el.innerHTML = `Configurata: <span class="apikey-masked">${esc(data.masked)}</span><br>Origine: ${esc(apikeySources[data.source] || data.source)}.`;
  } catch (err) {
    el.textContent = 'Errore caricamento stato: ' + err.message;
  }
}

document.getElementById('apikeyShow').addEventListener('change', (e) => {
  document.getElementById('apikeyInput').type = e.target.checked ? 'text' : 'password';
});

document.getElementById('apikeyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showApikeyErr('');
  const input = document.getElementById('apikeyInput');
  const res = await fetch('/admin/api/apikey', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: input.value.trim() }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showApikeyErr(data.error || 'Errore durante il salvataggio'); return; }
  input.value = '';
  document.getElementById('apikeyShow').checked = false;
  input.type = 'password';
  loadApiKeyState();
  loadLogs();
});

document.getElementById('apikeyDelete').addEventListener('click', async () => {
  if (!confirm("Rimuovere la chiave API salvata? La conversione automatica smetterà di funzionare, a meno che una chiave non arrivi dalla variabile d'ambiente o da batch.config.json.")) return;
  showApikeyErr('');
  const res = await fetch('/admin/api/apikey', { method: 'DELETE', credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { showApikeyErr(data.error || 'Errore durante la rimozione'); return; }
  loadApiKeyState();
  loadLogs();
});

document.getElementById('helpBtn').addEventListener('click', (e) => {
  const helpPanel = document.getElementById('help');
  const content = document.getElementById('guideContent');

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  helpPanel.classList.add('active');
  e.target.classList.add('active');

  fetch('/docs-api/admin-guide')
    .then(r => r.json())
    .then(data => {
      const md = data.content || '';
      content.innerHTML = parseMarkdown(md);
    })
    .catch(err => {
      content.innerHTML = `<p style="color: #991b1b;">Errore caricamento guida: ${err.message}</p>`;
    });
});

loadUsers();
loadLogs();
loadActiveAccounts();
loadDDTValidations();
loadApiKeyState();
