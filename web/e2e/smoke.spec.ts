import { expect, test, type Page } from '@playwright/test'

// Utenti del seed demo (scripts/seed.py).
const MANAGER = { email: 'manager@fieldview.local', password: 'demo1234' }

async function login(page: Page, user = MANAGER) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: /accedi|entra|login/i }).click()
  await page.waitForURL('**/projects')
}

test('login → planimetria → nuovo pin → pannello → rinomina', async ({ page }) => {
  await login(page)

  // progetto e planimetria demo
  await page.getByRole('link', { name: /Cantiere demo/ }).click()
  await page.waitForURL('**/plans')
  await page.getByRole('link', { name: /Piano terra/ }).click()
  await page.waitForURL(/\/plans\/[0-9a-f-]+$/)
  await expect(page.locator('.plan-canvas img')).toBeVisible()
  const before = await page.locator('.pin').count()
  expect(before).toBeGreaterThan(0) // il seed mette 3 pin

  // aggiungi pin con un click sulla planimetria
  await page.getByRole('button', { name: '+ Aggiungi pin' }).click()
  const box = await page.locator('.plan-canvas').boundingBox()
  if (!box) throw new Error('canvas non visibile')
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.4)

  // il pannello si apre sul pin nuovo e la mappa mostra un marker in più
  const panel = page.locator('.pin-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Pin senza etichetta')).toBeVisible()
  await expect(page.locator('.pin')).toHaveCount(before + 1)

  // rinomina dal titolo del pannello
  await panel.locator('.pin-title').click()
  await panel.getByPlaceholder('Etichetta').fill('Smoke test')
  await panel.getByRole('button', { name: 'Salva' }).click()
  await expect(panel.locator('h2')).toContainText('Smoke test')
  await expect(page.locator('.pin[aria-label="Smoke test"]')).toBeVisible()

  // il pin esiste anche via API (stessa origine, /api)
  const token = await page.evaluate(() => localStorage.getItem('fieldview.token'))
  const planId = page.url().split('/').pop()
  const res = await page.request.get(`/api/plans/${planId}/pins`, { headers: { Authorization: `Bearer ${token}` } })
  expect(res.ok()).toBeTruthy()
  expect((await res.json()).some((p: { label: string | null }) => p.label === 'Smoke test')).toBeTruthy()

  // pulizia: cancella il pin creato
  page.once('dialog', (d) => d.accept())
  await panel.getByRole('button', { name: 'Cancella pin' }).click()
  await expect(panel).toBeHidden()
  await expect(page.locator('.pin')).toHaveCount(before)
  await expect(page.locator('.toast-success')).toContainText('Pin cancellato')
})

test('credenziali sbagliate mostrano errore, route protetta rimanda al login', async ({ page }) => {
  await page.goto('/projects')
  await page.waitForURL('**/login')
  await page.getByLabel('Email').fill(MANAGER.email)
  await page.getByLabel('Password').fill('sbagliata')
  await page.getByRole('button', { name: /accedi|entra|login/i }).click()
  await expect(page.locator('.error')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('filtri pin in query string e cambio planimetria senza reload', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: /Cantiere demo/ }).click()
  await page.getByRole('link', { name: /Piano terra/ }).click()
  await expect(page.locator('.plan-canvas img')).toBeVisible()
  const total = await page.locator('.pin').count()

  await page.getByRole('button', { name: 'Aperti' }).click()
  await expect(page).toHaveURL(/status=open/)
  await expect(page.locator('.filter-summary')).toContainText(`di ${total} pin`)
  await page.getByRole('button', { name: 'Azzera' }).click()
  await expect(page).not.toHaveURL(/status=/)
  await expect(page.locator('.pin')).toHaveCount(total)
})

// PNG 1×1 valido (il server riconosce il tipo dai byte)
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

test('compila "Ispezione sicurezza" con foto e firma dal pannello pin', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: /Cantiere demo/ }).click()
  await page.getByRole('link', { name: /Piano terra/ }).click()
  await expect(page.locator('.plan-canvas img')).toBeVisible()
  await page.locator('.pin').first().click()
  const panel = page.locator('.pin-panel')
  await expect(panel).toBeVisible()
  const before = Number((await panel.getByText(/^Moduli \(\d+\)$/).textContent())!.match(/\d+/)![0])

  await panel.getByRole('button', { name: '+ Compila modulo' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Modulo').selectOption({ label: 'Ispezione sicurezza' })

  // salvataggio a vuoto: errori inline, niente chiamata
  await modal.getByRole('button', { name: 'Salva modulo' }).click()
  await expect(modal.locator('.dyn-error').first()).toContainText('Campo obbligatorio')
  await expect(modal.locator('.form-actions .error')).toContainText(/campi da correggere/)

  await modal.getByLabel(/Area ispezionata/).fill('Vano scala B')
  await modal.getByLabel(/^Esito/).selectOption('Non conforme')
  await modal.getByText('Elettrico', { exact: true }).click() // multiselect a chip
  await modal.getByLabel(/Persone presenti/).fill('3')
  await modal.getByLabel('Lat').fill('45.46')
  await modal.getByLabel('Lng').fill('9.19')
  await modal.locator('#df-foto').setInputFiles({ name: 'quadro.png', mimeType: 'image/png', buffer: PNG_1PX })
  await expect(modal.locator('.photo-cell img')).toBeVisible()

  // firma: un tratto sul canvas
  const canvas = modal.locator('.signature-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 20, box.y + 80)
  await page.mouse.down()
  await page.mouse.move(box.x + 200, box.y + 40, { steps: 8 })
  await page.mouse.move(box.x + 400, box.y + 120, { steps: 8 })
  await page.mouse.up()
  await expect(modal.getByText('Firma acquisita')).toBeVisible()

  const tasksBefore = Number((await panel.getByText(/^Task \(\d+\)$/).textContent())!.match(/\d+/)![0])
  await modal.getByRole('button', { name: 'Salva modulo' }).click() // click 1
  await expect(page.locator('.toast-success')).toContainText('Modulo salvato')
  await expect(panel.getByText(`Moduli (${before + 1})`)).toBeVisible()

  // regola MVP: "Non conforme" propone un task pre-compilato -> assegnato in 3 click
  const taskModal = page.getByRole('dialog', { name: /Non conformità rilevata/ })
  await expect(taskModal).toBeVisible()
  await expect(taskModal.getByLabel('Titolo')).toHaveValue(/Non conforme — Ispezione sicurezza/)
  await expect(taskModal.getByLabel('Descrizione')).toHaveValue(/Area ispezionata: Vano scala B/)
  await taskModal.getByLabel('Assegna a').selectOption({ label: 'Franco Field' }) // click 2
  await taskModal.getByRole('button', { name: 'Crea e assegna' }).click() // click 3
  await expect(page.locator('.toast-success').last()).toContainText('Task creato e assegnato')
  await expect(panel.getByText(`Task (${tasksBefore + 1})`)).toBeVisible()
  await expect(panel.locator('.list li', { hasText: 'Non conforme — Ispezione sicurezza' }).locator('.badge')).toHaveText('Assegnato')

  // dettaglio submission in sola lettura, poi modifica
  await panel.locator('.list-item-btn', { hasText: 'Ispezione sicurezza' }).last().click()
  const detail = page.getByRole('dialog', { name: 'Ispezione sicurezza' })
  await expect(detail.getByLabel(/Area ispezionata/)).toHaveValue('Vano scala B')
  await expect(detail.getByLabel(/Area ispezionata/)).toBeDisabled()
  await expect(detail.locator('.callout-warn')).toContainText('Non conforme')
  await expect(detail.locator('.photo-cell img')).toHaveCount(1)
  await detail.getByRole('button', { name: 'Modifica' }).click()
  const edit = page.getByRole('dialog', { name: /Modifica — Ispezione sicurezza/ })
  await edit.getByLabel(/Area ispezionata/).fill('Vano scala B, piano 2')
  await edit.getByRole('button', { name: 'Salva modifiche' }).click()
  await expect(page.locator('.toast-success').last()).toContainText('Modulo aggiornato')
  await expect(detail.getByLabel(/Area ispezionata/)).toHaveValue('Vano scala B, piano 2')
  await detail.locator('.form-actions').getByRole('button', { name: 'Chiudi' }).click()
  await expect(detail).toBeHidden()
  await expect(panel.locator('.photo-grid img')).toHaveCount(1) // la foto; la firma non è nella griglia foto

  // via API: submission con esito e 2 allegati caricati
  const token = await page.evaluate(() => localStorage.getItem('fieldview.token'))
  const selected = await page.locator('.pin-selected').getAttribute('data-pin-id')
  const res = await page.request.get(`/api/pins/${selected}`, { headers: { Authorization: `Bearer ${token}` } })
  const pinDetail = await res.json()
  const sub = pinDetail.submissions.find((s: { data_json: { area?: string } }) => s.data_json.area === 'Vano scala B, piano 2')
  expect(sub).toBeTruthy()
  const task = pinDetail.tasks.find((t: { title: string }) => t.title.startsWith('Non conforme — Ispezione sicurezza'))
  expect(task.status).toBe('assigned')
  expect(task.assigned_to).toBeTruthy()
  expect(sub.data_json.esito).toBe('Non conforme')
  expect(sub.data_json.rischi).toEqual(['Elettrico'])
  expect(sub.data_json.persone_presenti).toBe(3)
  expect(sub.data_json.posizione).toEqual({ lat: 45.46, lng: 9.19 })
  expect(sub.attachments).toHaveLength(2)
  expect(sub.attachments.every((a: { file_url: string | null }) => a.file_url)).toBeTruthy()
  expect(sub.attachments.map((a: { file_type: string }) => a.file_type).sort()).toEqual(['photo', 'signature'])
  expect(sub.data_json.foto).toEqual([sub.attachments.find((a: { file_type: string }) => a.file_type === 'photo').id])
  expect(sub.data_json.firma_ispettore).toBe(sub.attachments.find((a: { file_type: string }) => a.file_type === 'signature').id)
})

test('vista task: filtri, cambio stato/assegnatario inline, link alla planimetria', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: /Cantiere demo/ }).click()
  await page.getByRole('link', { name: 'Task', exact: true }).click()
  await page.waitForURL('**/tasks')
  const rows = page.locator('.tasks-table tbody tr')
  await expect(rows.first()).toBeVisible()
  const total = await rows.count()
  expect(total).toBeGreaterThanOrEqual(3)

  // un task aperto: assegnarlo lo porta ad "assigned" senza toccare lo stato
  const firstOpen = page.locator('.tasks-table tbody tr', { has: page.locator('.status-select.status-open') }).first()
  const title = await firstOpen.locator('td strong').first().textContent()
  const openRow = page.locator('.tasks-table tbody tr', { hasText: title! }) // stabile anche quando cambia stato
  await openRow.getByLabel(`Assegnatario di ${title}`).selectOption({ label: 'Franco Field' })
  await expect(openRow.locator('.status-select')).toHaveValue('assigned')

  // poi risolto, con scadenza
  await openRow.getByLabel(`Stato di ${title}`).selectOption('resolved')
  await expect(openRow.locator('.status-select')).toHaveValue('resolved')
  await openRow.getByLabel(`Scadenza di ${title}`).fill('2030-12-31')
  await page.reload()
  const sameRow = page.locator('.tasks-table tbody tr', { hasText: title! })
  await expect(sameRow.locator('.status-select')).toHaveValue('resolved')
  await expect(sameRow.getByLabel(`Scadenza di ${title}`)).toHaveValue('2030-12-31')
  await expect(sameRow.getByLabel(`Assegnatario di ${title}`)).toHaveValue(/.+/)

  // filtro stato in URL e "i miei task" (il manager non ha task assegnati)
  await page.getByRole('button', { name: 'Risolto' }).click()
  await expect(page).toHaveURL(/status=resolved/)
  await expect(page.locator('.filter-summary')).toContainText(`di ${total} task`)
  await page.getByRole('button', { name: 'Azzera' }).click()
  await page.getByRole('button', { name: 'I miei task' }).click()
  await expect(page).toHaveURL(/mine=1/)
  await expect(page.locator('.filter-summary')).toContainText(`di ${total} task`)
  for (const sel of await page.locator('.tasks-table tbody select[aria-label^="Assegnatario"]').all()) {
    await expect(sel.locator('option:checked')).toHaveText('Maria Manager')
  }
  await page.getByRole('button', { name: 'Tutti i task' }).click()

  // "vedi sulla planimetria": apre la plan view con il pin selezionato e il pannello
  await sameRow.getByTitle('Vedi sulla planimetria').click()
  await page.waitForURL(/\/plans\/[0-9a-f-]+/)
  await expect(page.locator('.pin-panel')).toBeVisible()
  await expect(page.locator('.pin-panel')).toContainText(title!)
  await expect(page.locator('.pin-selected')).toHaveCount(1)
  await expect(page).not.toHaveURL(/pin=/) // parametro consumato
  const zoom = await page.locator('.plan-zoom').textContent()
  expect(Number(zoom!.replace('%', ''))).toBeGreaterThanOrEqual(100)
})

test('form builder: creo "Diario giornaliero" e lo compilo su un pin', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: 'Moduli' }).click()
  await page.waitForURL('**/templates')
  await expect(page.locator('.table tbody tr')).toHaveCount(3) // i 3 template del seed
  await page.getByRole('link', { name: '+ Nuovo template' }).click()
  await page.waitForURL('**/templates/new')

  const name = `Diario giornaliero e2e ${Date.now() % 10000}`
  await page.getByLabel('Nome').fill(name)
  await page.getByLabel('Categoria').selectOption('diary')

  const addField = async (type: string, label: string) => {
    await page.getByLabel('Tipo del nuovo campo').selectOption(type)
    await page.getByRole('button', { name: '+ Aggiungi campo' }).click()
    await page.getByLabel('Etichetta').fill(label)
  }
  await addField('date', 'Data')
  await page.getByLabel('Valore iniziale').selectOption('today')
  await addField('textarea', 'Attività svolte')
  await page.getByLabel('Obbligatorio').check()
  await addField('number', 'Operai presenti')
  await page.getByLabel('Solo numeri interi').check()
  await addField('select', 'Meteo')
  await page.getByLabel('Opzioni (una per riga)').fill('Sole\nPioggia\nNuvoloso')
  await page.getByLabel('Opzioni (una per riga)').blur()
  await addField('photo', 'Foto del giorno')
  await page.getByLabel('Più foto').check()

  // id derivati dalle etichette, anteprima live valida
  await expect(page.locator('.field-list')).toContainText('attivita_svolte')
  await expect(page.locator('.field-list')).toContainText('operai_presenti')
  await expect(page.locator('.builder-preview .dyn-field')).toHaveCount(5)
  await expect(page.locator('.builder-preview').getByLabel(/^Data/)).toHaveValue(/^\d{4}-\d{2}-\d{2}$/)

  // errore di schema segnalato: opzione duplicata, poi corretta
  await page.locator('.field-row', { hasText: 'Meteo' }).locator('.field-row-main').click()
  await page.getByLabel('Opzioni (una per riga)').fill('Sole\nSole')
  await page.getByLabel('Opzioni (una per riga)').blur()
  await expect(page.locator('.field-props .error')).toContainText('duplicates')
  await page.getByLabel('Opzioni (una per riga)').fill('Sole\nPioggia\nNuvoloso')
  await page.getByLabel('Opzioni (una per riga)').blur()
  await expect(page.locator('.field-props .error')).toHaveCount(0)

  await page.getByRole('button', { name: 'Salva' }).click()
  await expect(page.locator('.toast-success')).toContainText('Template creato')
  await page.waitForURL(/\/templates\/[0-9a-f-]+$/)

  // compilazione su un pin con il nuovo template
  await page.getByRole('link', { name: 'Progetti' }).click()
  await page.getByRole('link', { name: /Cantiere demo/ }).click()
  await page.getByRole('link', { name: /Piano terra/ }).click()
  await page.locator('.pin').first().click()
  await page.getByRole('button', { name: '+ Compila modulo' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Modulo').selectOption({ label: name })
  await modal.getByLabel(/Attività svolte/).fill('Getto solaio piano 1')
  await modal.getByLabel(/Operai presenti/).fill('6')
  await modal.getByLabel(/^Meteo/).selectOption('Sole')
  await modal.getByRole('button', { name: 'Salva modulo' }).click()
  await expect(page.locator('.toast-success').last()).toContainText('Modulo salvato')
  await expect(page.locator('.pin-panel .list-item-btn', { hasText: name })).toBeVisible()

  // il template in uso è bloccato nell'editor; archiviato sparisce da "Compila modulo"
  await page.getByRole('link', { name: 'Moduli' }).click()
  const row = page.locator('.table tbody tr', { hasText: name })
  await expect(row.locator('.badge')).toHaveText('In uso')
  await row.getByRole('link', { name: 'Apri' }).click()
  await expect(page.locator('.callout-warn')).toContainText('1 compilazioni')
  await expect(page.getByLabel('Etichetta')).toBeDisabled()
  await page.getByRole('link', { name: 'Template dei moduli' }).click()
  await row.getByRole('button', { name: 'Archivia' }).click()
  await expect(page.locator('.toast-success').last()).toContainText('archiviato')
  await expect(row).toHaveCount(0)
  await page.getByRole('link', { name: 'Progetti' }).click()
  await page.getByRole('link', { name: /Cantiere demo/ }).click()
  await page.getByRole('link', { name: /Piano terra/ }).click()
  await page.locator('.pin').first().click()
  await expect(page.locator('.pin-panel .list-item-btn', { hasText: name })).toBeVisible() // la vecchia compilazione resta leggibile
  await page.getByRole('button', { name: '+ Compila modulo' }).click()
  await expect(page.getByRole('dialog').getByLabel('Modulo').locator('option', { hasText: name })).toHaveCount(0)
})

test('dashboard: card e grafici, click porta alla vista task filtrata', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: /Cantiere demo/ }).click()
  await page.getByRole('link', { name: 'Dashboard' }).click()
  await page.waitForURL('**/dashboard')
  await expect(page.locator('.stat-tile')).toHaveCount(3)
  await expect(page.locator('.stat-tile').first()).toContainText('Task aperti')
  const openTile = Number((await page.locator('.stat-tile .stat-value').first().textContent())!.trim())
  expect(openTile).toBeGreaterThan(0)
  await expect(page.locator('.chart-card')).toHaveCount(4)
  await expect(page.locator('.chart-card').nth(0).locator('.recharts-bar-rectangle')).toHaveCount(4)
  await expect(page.locator('.chart-card').nth(1).locator('.recharts-line')).toHaveCount(2)
  // filtro planimetria in URL e vista tabellare
  await page.getByLabel('Planimetria').selectOption({ index: 1 })
  await expect(page).toHaveURL(/plan=/)
  await page.getByRole('button', { name: 'Tabella' }).click()
  await expect(page.locator('.table')).toContainText('Task aperto')
  await page.getByRole('button', { name: 'Grafici' }).click()
  // click sulla card "Task aperti" -> vista task con status open+assigned e stessa planimetria
  await page.locator('.stat-tile').first().click()
  await page.waitForURL(/\/tasks\?/)
  expect(page.url()).toMatch(/status=open/)
  expect(page.url()).toMatch(/status=assigned/)
  expect(page.url()).toMatch(/plan=/)
  await expect(page.locator('.filter-summary')).toContainText(/di \d+ task/)
})

test('spazio admin: crea utente, reset password, disattiva; registro operazioni con filtri e dettaglio', async ({ page }) => {
  await login(page, { email: 'admin@fieldview.local', password: 'demo1234' })
  await page.getByRole('link', { name: 'Utenti' }).click()
  await expect(page.getByRole('heading', { name: 'Utenti' })).toBeVisible()
  await expect(page.locator('.users-table tbody tr')).toHaveCount(3)

  // crea
  await page.getByRole('button', { name: '+ Nuovo utente' }).click()
  const modal = page.getByRole('dialog')
  await modal.getByLabel('Nome e cognome').fill('Geom. Fabio Restivo')
  await modal.getByLabel('Email (login)').fill('fabio.restivo@fieldview.local')
  await modal.getByLabel('Ruolo').selectOption('manager')
  await modal.getByLabel(/Password iniziale/).fill('cantiere2026')
  await modal.getByRole('button', { name: 'Crea utente' }).click()
  await expect(page.locator('.toast-success', { hasText: 'creato' })).toBeVisible()
  const row = page.locator('.users-table tbody tr', { hasText: 'Fabio Restivo' })
  await expect(row).toContainText('Ufficio')

  // reset password + disattiva (conferma nativa)
  await row.getByRole('button', { name: 'Password' }).click()
  await page.getByRole('dialog').getByLabel(/Nuova password/).fill('nuova12345')
  await page.getByRole('dialog').getByRole('button', { name: 'Reimposta' }).click()
  await expect(page.locator('.toast-success', { hasText: 'reimpostata' })).toBeVisible()
  page.once('dialog', (d) => d.accept())
  await row.getByRole('button', { name: 'Disattiva' }).click()
  await expect(page.locator('.toast-success', { hasText: 'disattivato' })).toBeVisible()
  await expect(page.locator('.users-table tbody tr', { hasText: 'Fabio Restivo' })).toHaveCount(0) // nascosto di default
  await page.getByLabel('Mostra disattivati').check()
  await expect(page.locator('.users-table tbody tr', { hasText: 'Fabio Restivo' })).toContainText('Disattivato')

  // registro: storia dell'utente appena gestito
  await page.locator('.users-table tbody tr', { hasText: 'Fabio Restivo' }).getByRole('link', { name: 'Attività' }).click()
  await expect(page).toHaveURL(/\/admin\/audit\?actor=/)
  await expect(page.getByRole('heading', { name: 'Registro operazioni' })).toBeVisible()
  // l'utente disattivato non ha mai fatto login: nessuna operazione sua → azzera e guarda quelle dell'admin
  await expect(page.locator('.empty')).toBeVisible()
  await page.getByRole('button', { name: 'Azzera' }).click()
  const rows = page.locator('.audit-table tbody tr.audit-row')
  await expect(rows.first()).toContainText('Utente disattivato')
  await expect(page.locator('.audit-table')).toContainText('Password reimpostata')
  await expect(page.locator('.audit-table')).toContainText('Utente creato')
  // filtro per azione via select e dettaglio JSON
  await page.getByLabel('Azione').selectOption('user.created')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('fabio.restivo@fieldview.local')
  await rows.first().click()
  await expect(page.locator('.audit-json')).toContainText('"role": "manager"')
  await page.getByRole('button', { name: 'Storia di questa entità' }).click()
  await expect(rows).toHaveCount(3)
  // il manager non entra
  await page.getByRole('button', { name: 'Esci' }).click()
  await login(page)
  await page.goto('/admin/audit')
  await page.waitForURL('**/projects')
})
