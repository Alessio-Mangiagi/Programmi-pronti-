// Client di Viewpoint Field View — API SOAP (API_FormsServices.asmx).
//
// Non e' REST e non usa OAuth2: l'autenticazione e' un apiToken dentro il corpo
// della richiesta, e ogni operazione e' una busta SOAP. Qui c'e' l'involucro
// generico; le operazioni sono DICHIARATE in OPERAZIONI, cosi' aggiungerne una
// (quando arriva il resto del WSDL) e' scrivere qualche riga di dati, non codice.
//
// SOAP e' posizionale: l'ordine dei campi in `campi` deve essere quello del WSDL,
// altrimenti il servizio risponde con un fault poco chiaro.
import { CONFIG } from '../config.js';
import { log } from '../log.js';

export class ErroreFieldView extends Error {
  constructor(messaggio, { stato = 0, corpo = '', fault = null } = {}) {
    super(messaggio);
    this.name = 'ErroreFieldView';
    this.stato = stato;
    this.corpo = corpo;
    this.fault = fault;
  }
}

/** Operazioni note. `involucro` = elemento che racchiude i campi (null = campi diretti). */
export const OPERAZIONI = {
  AddForm: {
    descrizione: 'Crea un form a partire da un template gia\' esistente in Field View',
    involucro: 'formRequest',
    campi: ['FormTemplateID', 'OrganisationID', 'PersonID', 'ProjectID', 'ElementID'],
    risultato: 'AddFormResult',
  },
};

const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const tag = (nome, valore) => `<${nome}>${esc(valore)}</${nome}>`;

/** Busta SOAP 1.1 o 1.2 per un'operazione dichiarata. */
export function bustaSoap(operazione, valori = {}, { token = CONFIG.fieldview.token, ns = CONFIG.fieldview.namespace, versione = CONFIG.fieldview.soap } = {}) {
  const op = OPERAZIONI[operazione];
  if (!op) throw new ErroreFieldView(`operazione Field View sconosciuta: ${operazione} (note: ${Object.keys(OPERAZIONI).join(', ')})`);

  const campi = op.campi.map((c) => tag(c, valori[c])).join('');
  const corpo = op.involucro ? `<${op.involucro}>${campi}</${op.involucro}>` : campi;
  const interno = `<${operazione} xmlns="${ns}">${tag('apiToken', token)}${corpo}</${operazione}>`;

  return versione === '1.2'
    ? '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
      `<soap12:Body>${interno}</soap12:Body></soap12:Envelope>`
    : '<?xml version="1.0" encoding="utf-8"?>' +
      '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      `<soap:Body>${interno}</soap:Body></soap:Envelope>`;
}

/** Il fault SOAP e' l'errore "vero" del servizio: 1.1 usa faultstring, 1.2 Reason/Text. */
export function leggiFault(xml) {
  const f11 = /<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i.exec(xml);
  if (f11) return f11[1].trim();
  const f12 = /<[\w:]*Text[^>]*>([\s\S]*?)<\/[\w:]*Text>/i.exec(xml);
  if (f12 && /<[\w:]*Fault[\s>]/i.test(xml)) return f12[1].trim();
  return null;
}

/** Contenuto di <XxxResult>: e' XML annidato ed escapato, restituito com'e'. */
export function leggiRisultato(xml, nomeRisultato) {
  const re = new RegExp(`<[\\w:]*${nomeRisultato}[^>]*>([\\s\\S]*?)</[\\w:]*${nomeRisultato}>`, 'i');
  const m = re.exec(xml);
  if (!m) return null;
  return m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** Cosa manca per poter chiamare Field View: elenco di variabili, non un si'/no secco. */
export function mancanzeFieldView() {
  return [
    !CONFIG.fieldview.url && 'FIELDVIEW_URL',
    !CONFIG.fieldview.token && 'FIELDVIEW_TOKEN',
  ].filter(Boolean);
}

export function fieldviewConfigurato() {
  return mancanzeFieldView().length === 0;
}

/**
 * Esegue un'operazione dichiarata in OPERAZIONI.
 * @returns {Promise<{risultato:string|null, xml:string}>}
 */
export async function chiama(operazione, valori = {}) {
  if (!fieldviewConfigurato()) {
    throw new ErroreFieldView(`Field View non configurato: manca ${mancanzeFieldView().join(' e ')} in .env`);
  }
  const op = OPERAZIONI[operazione];
  const busta = bustaSoap(operazione, valori);
  const soap12 = CONFIG.fieldview.soap === '1.2';

  const intestazioni = soap12
    ? { 'content-type': 'application/soap+xml; charset=utf-8' }
    : { 'content-type': 'text/xml; charset=utf-8', soapaction: `"${CONFIG.fieldview.namespace}/${operazione}"` };

  const res = await fetch(CONFIG.fieldview.url, {
    method: 'POST',
    headers: intestazioni,
    body: busta,
    signal: AbortSignal.timeout(CONFIG.fieldview.timeoutMs),
  });
  const xml = await res.text();

  // Un fault SOAP puo' arrivare con 200 o con 500: conta il corpo, non lo stato.
  const fault = leggiFault(xml);
  if (fault) throw new ErroreFieldView(`${operazione}: ${fault}`, { stato: res.status, corpo: xml.slice(0, 600), fault });
  if (!res.ok) throw new ErroreFieldView(`${operazione} -> HTTP ${res.status}`, { stato: res.status, corpo: xml.slice(0, 600) });

  return { risultato: leggiRisultato(xml, op.risultato), xml };
}

/**
 * AddForm: crea un form da un template esistente. I valori mancanti si prendono
 * dal .env, cosi' la richiesta API puo' limitarsi a quello che cambia.
 */
export async function aggiungiForm(valori = {}) {
  const c = CONFIG.fieldview;
  const dati = {
    FormTemplateID: valori.formTemplateId ?? c.formTemplateId,
    OrganisationID: valori.organisationId ?? c.organisationId,
    PersonID: valori.personId ?? c.personId,
    ProjectID: valori.projectId ?? c.projectId,
    ElementID: valori.elementId ?? c.elementId,
  };
  const mancanti = Object.entries(dati).filter(([, v]) => v === '' || v == null).map(([k]) => k);
  if (mancanti.length) {
    throw new ErroreFieldView(`AddForm: mancano ${mancanti.join(', ')} (nella richiesta o in .env come FIELDVIEW_*)`);
  }

  const { risultato, xml } = await chiama('AddForm', dati);
  const formId = /<(?:FormID|formId|ID)>(\d+)<\//i.exec(risultato || '')?.[1] || null;
  log.info('Field View AddForm eseguita', { template: dati.FormTemplateID, progetto: dati.ProjectID, formId });
  return { formId, risultato, xml, richiesta: dati };
}
