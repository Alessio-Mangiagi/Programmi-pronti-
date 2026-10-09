/**
 * Redis Guard: consente solo comandi di LETTURA.
 * Whitelist esplicita: il primo token deve essere un comando di sola lettura.
 */

const READ_COMMANDS = new Set([
  // stringhe
  'get', 'mget', 'strlen', 'getrange', 'substr',
  // chiavi / generici — NB: KEYS volutamente escluso (blocca Redis su DB grandi → DoS); usare SCAN
  'exists', 'type', 'ttl', 'pttl', 'scan', 'dbsize', 'randomkey', 'object',
  // hash
  'hget', 'hmget', 'hgetall', 'hkeys', 'hvals', 'hlen', 'hexists', 'hscan', 'hstrlen',
  // liste
  'lrange', 'llen', 'lindex', 'lpos',
  // set
  'smembers', 'sismember', 'smismember', 'scard', 'srandmember', 'sscan', 'sinter', 'sunion', 'sdiff',
  // sorted set
  'zrange', 'zrangebyscore', 'zrangebylex', 'zrevrange', 'zcard', 'zscore', 'zmscore',
  'zrank', 'zrevrank', 'zcount', 'zscan',
  // bitmap / altro
  'bitcount', 'getbit', 'pfcount', 'geopos', 'geodist',
  // info diagnostica
  'info', 'memory', 'ttl',
])

export interface RedisGuardResult {
  ok: boolean
  reason?: string
  args: string[] // comando tokenizzato pronto per redis.call(...)
}

/** Tokenizza una riga di comando Redis rispettando le virgolette. */
function tokenize(cmd: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3])
  }
  return out
}

export function guardRedis(raw: string): RedisGuardResult {
  const cmd = (raw || '').trim()
  if (!cmd) return { ok: false, reason: 'Comando vuoto', args: [] }

  const args = tokenize(cmd)
  const head = args[0]?.toLowerCase()
  if (!head) return { ok: false, reason: 'Comando non valido', args: [] }

  if (!READ_COMMANDS.has(head)) {
    return { ok: false, reason: `Comando Redis non in sola lettura: ${head.toUpperCase()}`, args }
  }

  // MEMORY: solo sotto-comandi di lettura (USAGE/STATS/DOCTOR)
  if (head === 'memory') {
    const sub = args[1]?.toLowerCase()
    if (!['usage', 'stats', 'doctor'].includes(sub || '')) {
      return { ok: false, reason: 'MEMORY: solo USAGE/STATS/DOCTOR', args }
    }
  }
  return { ok: true, args }
}
