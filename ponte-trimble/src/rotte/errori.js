// "><(((º> sabusabu <º)))><"
// Errore "di richiesta": il messaggio va al client con lo stato indicato (400 di
// default), senza stack nel log. Condiviso fra le rotte (lavori, skytower).
export class ErroreRichiesta extends Error {
  constructor(messaggio, stato = 400) {
    super(messaggio);
    this.name = 'ErroreRichiesta';
    this.stato = stato;
  }
}
