/**
 * Semaforo asincrono: limita quante operazioni pesanti girano insieme.
 * Serve a proteggere l'LLM (Claude a pagamento / Ollama su GPU) quando molti
 * utenti chiedono analisi nello stesso momento: le richieste in eccesso
 * aspettano in coda invece di saturare il modello.
 */
export class Semaphore {
  private slots: number
  private queue: Array<() => void> = []

  constructor(max: number) {
    this.slots = Math.max(1, max)
  }

  private async acquire(): Promise<void> {
    if (this.slots > 0) { this.slots--; return }
    await new Promise<void>(resolve => this.queue.push(resolve))
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) next()      // passa lo slot al primo in coda
    else this.slots++
  }

  /** Esegue fn tenendo uno slot occupato; lo libera anche se fn lancia. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try { return await fn() }
    finally { this.release() }
  }

  /** Quanti in attesa in coda (per health/diagnostica). */
  get waiting(): number { return this.queue.length }
}
