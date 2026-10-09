import type { ReactNode } from 'react'

/** Colonna brand del login: split-screen con tagline Cosedil. */
function BrandPane() {
  return (
    <div className="login-brand">
      <div className="brand">
        <img src="/favicon.webp" alt="Cosedil" width="30" height="30" />
        <h1>Cosedil · Agente DB</h1>
      </div>
      <div>
        <div className="login-tagline">Costruiamo il <em>tuo</em> domani.</div>
        <div className="login-sub">
          I dati dei cantieri, delle commesse e dei fornitori — interrogabili in italiano,
          senza scrivere una riga di SQL.
        </div>
        <div className="login-rule" />
      </div>
    </div>
  )
}

// "><(((º> sabusabu <º)))><"
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="login-wrap">
      <BrandPane />
      <div className="login-form-col">
        <div className="login-card">{children}</div>
      </div>
    </div>
  )
}
