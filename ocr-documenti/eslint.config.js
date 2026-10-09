// ESLint (flat config): TypeScript + regole degli hook React.
// Solo correttezza, niente stile: la formattazione la decide chi scrive.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', '.venv/', '.venv-gpu/', '_archivio/', '_lavori/', 'tests/', 'public/', 'tools/harness/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['server.ts', 'server/**/*.ts', 'tools/**/*.{ts,mjs}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      // `_x` = parametro volutamente ignorato (convenzione già usata nel codice: _req, _e)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // catch {} vuoti con commento sono la norma qui ("illeggibile → nessuna miniatura")
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `while (true)` con return dentro (runPool) e regex con caratteri di controllo
      // (pulizia OCR) sono voluti
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-control-regex': 'off',
      // stringhe raw con `\d` dentro String.raw e regex Unicode: falsi positivi
      'no-useless-escape': 'off',
      'no-misleading-character-class': 'off',
      // `{}` come "oggetto qualsiasi" e i cast `as unknown as X` sulle API senza tipi
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
)
