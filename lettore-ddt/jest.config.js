module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/static/js'],
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js|jsx)', '**/?(*.)+(spec|test).(ts|tsx|js|jsx)'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  // "><(((º> sabusabu <º)))><"
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    'static/js/**/*.{js,jsx}',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
  ],
  // Cricchetto: le soglie stanno appena sotto la copertura reale, così una
  // regressione fa fallire "npm run test:coverage" (che ora gira in CI).
  // Si alzano quando la copertura sale, non si abbassano mai per far passare
  // la pipeline — prima erano a 60/40/48/60 con la copertura al 45%, cioè un
  // vincolo che nessuno poteva rispettare e che infatti nessuno applicava.
  coverageThreshold: {
    global: {
      // Un punto di margine: la copertura oscilla di poco tra un giro e
      // l'altro (rami che dipendono dall'ambiente), e una CI che fallisce a
      // caso smette di essere presa sul serio.
      statements: 53,
      branches: 42,
      functions: 52,
      lines: 54,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  forceExit: true,
};