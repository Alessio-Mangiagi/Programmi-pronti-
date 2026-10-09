import { IconAlert } from '../icons'
import type { Health } from '../types'

/**
 * Banner in testa alla pagina quando il motore AI di default non è pronto:
 * senza, l'utente scopre il problema solo al primo "Errore" in chat.
 */
export function ModelBanner({ health }: { health: Health | null }) {
  if (!health || health.defaultLlm !== 'ollama') return null
  if (health.ollama && health.ollamaModel) return null
  const model = health.ollamaModelName || 'il modello configurato'
  return (
    <div className="err-card" style={{ margin: '10px 14px 0', flexShrink: 0 }}>
      <IconAlert size={15} />
      <span>
        {!health.ollama
          ? 'Ollama non è attivo: avvialo (o riavvia l\'app) per usare l\'AI locale.'
          : <>Modello Ollama <b>«{model}»</b> mancante: aprire un terminale ed eseguire <code>ollama pull {model}</code>. Le analisi falliranno finché non è scaricato.</>}
      </span>
    </div>
  )
}
