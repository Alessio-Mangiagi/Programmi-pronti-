import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

// "><(((º> sabusabu <º)))><"
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Errore non gestito nella UI:', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'sans-serif' }}>
          <h2>Si è verificato un errore imprevisto</h2>
          <p>{this.state.error.message}</p>
          <button onClick={() => window.location.reload()}>Ricarica la pagina</button>
        </div>
      );
    }
    return this.props.children;
  }
}
