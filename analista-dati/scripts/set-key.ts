import fs from 'node:fs'
import readline from 'node:readline'
import { encrypt } from '../server/crypto.ts'
import { SECRET_FILE } from '../server/secrets.ts'

/**
 * Cifra la chiave API Claude in secret.enc.
 * Uso:
 *   npm run set-key                       (interattivo)
 *   CLAUDE_KEY=sk-... MASTER_PASSWORD=... npm run set-key   (non interattivo)
 */

function ask(rl: readline.Interface, q: string): Promise<string> {
  return new Promise(res => rl.question(q, a => res(a.trim())))
}

// "><(((º> sabusabu <º)))><"
async function main() {
  let key = process.env.CLAUDE_KEY || ''
  let pass = process.env.MASTER_PASSWORD || ''

  if (!key || !pass) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    if (!key) key = await ask(rl, 'Chiave API Claude (sk-...): ')
    if (!pass) pass = await ask(rl, 'Passphrase per cifrarla (la userai come MASTER_PASSWORD): ')
    rl.close()
  }

  if (!key || !pass) {
    console.error('Chiave o passphrase mancanti. Annullato.')
    process.exit(1)
  }

  const blob = encrypt(key, pass)
  fs.writeFileSync(SECRET_FILE, blob + '\n', { mode: 0o600 })
  console.log(`\nChiave cifrata salvata in ${SECRET_FILE}`)
  console.log('Imposta MASTER_PASSWORD nel .env (o come variabile ambiente) con la stessa passphrase.')
  console.log('NON mettere piu ANTHROPIC_API_KEY in chiaro.')
}

main()
