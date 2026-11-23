// "><(((º> sabusabu <º)))><"
/**
 * Rete di sicurezza dell'interfaccia: se una pagina va in errore durante il disegno,
 * mostra un messaggio con "Riprova" invece di lasciare la schermata bianca. Il menu
 * resta usabile perché il blocco avvolge solo il contenuto della pagina (Layout).
 * React gestisce questi errori solo con un componente a classe.
 */
import { Component, type ReactNode } from 'react';

export class BloccoErrori extends Component<{ children: ReactNode; chiave: string }, { errore: Error | null }> {
  state = { errore: null as Error | null };

  static getDerivedStateFromError(errore: Error) {
    return { errore };
  }

  componentDidCatch(errore: Error) {
    console.error('[logbook] errore nella pagina:', errore);
  }

  componentDidUpdate(precedenti: { chiave: string }) {
    // Cambiando pagina dal menu si riparte puliti.
    if (precedenti.chiave !== this.props.chiave && this.state.errore) this.setState({ errore: null });
  }

  render() {
    if (!this.state.errore) return this.props.children;
    return (
      <div role="alert" className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold">Si è verificato un errore in questa pagina.</p>
        <p className="mt-1">{this.state.errore.message}</p>
        <button type="button" className="mt-3 rounded border border-red-300 bg-white px-3 py-1.5" onClick={() => this.setState({ errore: null })}>
          Riprova
        </button>
      </div>
    );
  }
}
