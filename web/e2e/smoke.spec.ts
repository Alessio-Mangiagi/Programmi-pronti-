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
