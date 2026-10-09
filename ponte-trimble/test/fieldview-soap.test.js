// Client SOAP di Field View, provato contro un finto servizio locale:
// nessuna chiamata esce verso Trimble e non serve un token vero.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CONFIG } from '../src/config.js';
import {
  bustaSoap, leggiFault, leggiRisultato, chiama, aggiungiForm,
  fieldviewConfigurato, ErroreFieldView, OPERAZIONI,
} from '../src/trimble/fieldview.js';
import { statoDestinazione, DESTINAZIONI } from '../src/destinazione.js';

const RISPOSTA_OK = (risultato) =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
  '<AddFormResponse xmlns="https://localhost.priority1.uk.net/Priority1WebServices/XML">' +
  `<AddFormResult>${risultato}</AddFormResult>` +
  '</AddFormResponse></soap:Body></soap:Envelope>';

const FAULT = '<?xml version="1.0" encoding="utf-8"?>' +
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
  '<soap:Fault><faultcode>soap:Server</faultcode>' +
  '<faultstring>Invalid apiToken</faultstring></soap:Fault>' +
  '</soap:Body></soap:Envelope>';

// Finto servizio: registra l'ultima richiesta e risponde quello che gli si dice.
let ultima = null;
let prossimaRisposta = { stato: 200, corpo: RISPOSTA_OK('&lt;Form&gt;&lt;FormID&gt;4711&lt;/FormID&gt;&lt;/Form&gt;') };

const server = http.createServer((req, res) => {
  let corpo = '';
  // "><(((º> sabusabu <º)))><"
  req.on('data', (c) => { corpo += c; });
  req.on('end', () => {
    ultima = { metodo: req.method, intestazioni: req.headers, corpo };
    res.writeHead(prossimaRisposta.stato, { 'content-type': 'text/xml; charset=utf-8' });
    res.end(prossimaRisposta.corpo);
  });
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

const CONFIG_ORIGINALE = { ...CONFIG.fieldview, destinazione: CONFIG.destinazione };
CONFIG.fieldview.url = 'http://127.0.0.1:' + server.address().port + '/API_FormsServices.asmx';
CONFIG.fieldview.token = 'token-di-prova';

test.after(() => {
  Object.assign(CONFIG.fieldview, CONFIG_ORIGINALE);
  CONFIG.destinazione = CONFIG_ORIGINALE.destinazione;
  server.close();
});

test('busta SOAP 1.1: apiToken, involucro e campi nell\'ordine del WSDL', () => {
  const busta = bustaSoap('AddForm', {
    FormTemplateID: 12, OrganisationID: 3, PersonID: 'ab-1', ProjectID: 99, ElementID: 7,
  }, { token: 'T', ns: 'https://esempio/NS', versione: '1.1' });

  assert.match(busta, /<soap:Envelope[^>]+schemas\.xmlsoap\.org\/soap\/envelope/);
  assert.match(busta, /<AddForm xmlns="https:\/\/esempio\/NS">/);
  assert.match(
    busta,
    /<apiToken>T<\/apiToken><formRequest><FormTemplateID>12<\/FormTemplateID><OrganisationID>3<\/OrganisationID><PersonID>ab-1<\/PersonID><ProjectID>99<\/ProjectID><ElementID>7<\/ElementID><\/formRequest>/,
  );
});

test('busta SOAP 1.2: cambia solo l\'involucro', () => {
  const busta = bustaSoap('AddForm', { FormTemplateID: 1 }, { token: 'T', ns: 'n', versione: '1.2' });
  assert.match(busta, /<soap12:Envelope[^>]+www\.w3\.org\/2003\/05\/soap-envelope/);
  assert.equal(/soap:Envelope/.test(busta), false);
});

test('i valori finiscono escapati: & e < non rompono la busta', () => {
  const busta = bustaSoap('AddForm', { PersonID: 'Rossi & <figli>' }, { token: 'T', ns: 'n' });
  assert.match(busta, /<PersonID>Rossi &amp; &lt;figli&gt;<\/PersonID>/);
});

test('operazione sconosciuta: dice quali sono note', () => {
  assert.throws(() => bustaSoap('CancellaTutto', {}), /operazione Field View sconosciuta: CancellaTutto.*AddForm/s);
  assert.deepEqual(Object.keys(OPERAZIONI), ['AddForm']);
});

test('AddForm: manda SOAPAction e legge il FormID dal risultato', async () => {
  prossimaRisposta = { stato: 200, corpo: RISPOSTA_OK('&lt;Form&gt;&lt;FormID&gt;4711&lt;/FormID&gt;&lt;/Form&gt;') };
  const esito = await aggiungiForm({
    formTemplateId: 12, organisationId: 3, personId: 'ab-1', projectId: 99, elementId: 7,
  });

  assert.equal(ultima.metodo, 'POST');
  assert.equal(ultima.intestazioni['content-type'], 'text/xml; charset=utf-8');
  assert.equal(ultima.intestazioni.soapaction, `"${CONFIG.fieldview.namespace}/AddForm"`);
  assert.match(ultima.corpo, /<apiToken>token-di-prova<\/apiToken>/);

  assert.equal(esito.formId, '4711');
  assert.equal(esito.risultato, '<Form><FormID>4711</FormID></Form>');   // risultato dis-escapato
  assert.deepEqual(esito.richiesta, {
    FormTemplateID: 12, OrganisationID: 3, PersonID: 'ab-1', ProjectID: 99, ElementID: 7,
  });
});

test('fault SOAP con HTTP 200: e\' comunque un errore, col messaggio del servizio', async () => {
  prossimaRisposta = { stato: 200, corpo: FAULT };
  await assert.rejects(
    () => chiama('AddForm', { FormTemplateID: 1 }),
    (e) => e instanceof ErroreFieldView && /AddForm: Invalid apiToken/.test(e.message) && e.fault === 'Invalid apiToken',
  );
});

test('HTTP 500 senza fault: si vede lo stato e un pezzo di corpo', async () => {
  prossimaRisposta = { stato: 500, corpo: '<html>errore del gateway</html>' };
  await assert.rejects(
    () => chiama('AddForm', { FormTemplateID: 1 }),
    (e) => e.stato === 500 && /HTTP 500/.test(e.message) && /gateway/.test(e.corpo),
  );
});

test('AddForm senza gli id: dice quali mancano e dove metterli', async () => {
  await assert.rejects(
    () => aggiungiForm({ formTemplateId: 1 }),
    /mancano OrganisationID, PersonID, ProjectID, ElementID.*FIELDVIEW_\*/s,
  );
});

test('letture di supporto: fault e risultato', () => {
  assert.equal(leggiFault(RISPOSTA_OK('x')), null);
  assert.equal(leggiFault(FAULT), 'Invalid apiToken');
  assert.equal(leggiRisultato(RISPOSTA_OK('&lt;a/&gt;'), 'AddFormResult'), '<a/>');
  assert.equal(leggiRisultato(RISPOSTA_OK('x'), 'AltroResult'), null);
});

test('destinazione: stato coerente con la configurazione', () => {
  assert.deepEqual(DESTINAZIONI, ['fieldview', 'connect', 'nessuna']);

  CONFIG.destinazione = 'fieldview';
  assert.equal(fieldviewConfigurato(), true);
  assert.deepEqual(
    { nome: statoDestinazione().nome, ok: statoDestinazione().configurata },
    { nome: 'fieldview', ok: true },
  );

  const token = CONFIG.fieldview.token;
  CONFIG.fieldview.token = '';
  assert.match(statoDestinazione().motivo, /^manca FIELDVIEW_TOKEN in \.env$/);   // l'URL ha un default
  CONFIG.fieldview.token = token;

  CONFIG.destinazione = 'nessuna';
  assert.equal(statoDestinazione().configurata, true);

  CONFIG.destinazione = 'sbagliata';
  assert.match(statoDestinazione().motivo, /destinazione sconosciuta/);
});
