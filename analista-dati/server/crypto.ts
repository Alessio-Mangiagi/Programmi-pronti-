import crypto from 'node:crypto'

/**
 * Cifratura simmetrica AES-256-GCM.
 * La chiave AES è derivata da una passphrase con scrypt (salt casuale per blob).
 * Formato blob (base64): salt(16) | iv(12) | authTag(16) | ciphertext
 */

const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return crypto.scryptSync(passphrase, salt, 32) // 256 bit
}

export function encrypt(plaintext: string, passphrase: string): string {
  const salt = crypto.randomBytes(SALT_LEN)
  const iv = crypto.randomBytes(IV_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([salt, iv, tag, enc]).toString('base64')
}

export function decrypt(blobB64: string, passphrase: string): string {
  const blob = Buffer.from(blobB64, 'base64')
  const salt = blob.subarray(0, SALT_LEN)
  const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN)
  const tag = blob.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN)
  const enc = blob.subarray(SALT_LEN + IV_LEN + TAG_LEN)
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
