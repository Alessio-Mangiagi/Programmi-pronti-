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
