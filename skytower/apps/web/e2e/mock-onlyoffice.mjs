// "><(((º> sabusabu <º)))><"
// Document Server OnlyOffice finto per gli e2e della modifica in piattaforma (solo Node, nessuna dipendenza):
// /web-apps/apps/api/documents/api.js definisce DocsAPI.DocEditor, che al posto dell'editor mostra titolo e chiave
// ricevuti; /cache/salvato.docx è il file "salvato" che la callback indica al CDE.
// Uso: node e2e/mock-onlyoffice.mjs <porta>
import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 4330);

const API_JS = `
window.DocsAPI = {
  DocEditor: function (id, config) {
    var host = document.getElementById(id);
    var box = document.createElement("section");
    box.setAttribute("aria-label", "Editor OnlyOffice");
    box.setAttribute("data-key", config.document.key);
    box.textContent = "Editor finto: " + config.document.title + " (" + config.documentType + ")";
    host.appendChild(box);
    window.__onlyoffice = config;
    return { destroyEditor: function () { box.remove(); } };
  },
};`;

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (url.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
  if (url.pathname === "/web-apps/apps/api/documents/api.js") {
    res.writeHead(200, { "content-type": "application/javascript", "access-control-allow-origin": "*" });
    return res.end(API_JS);
  }
  if (url.pathname === "/cache/salvato.docx") {
    const body = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.from(`salvato ${Date.now()} `.repeat(200))]);
    res.writeHead(200, { "content-type": "application/octet-stream", "content-length": body.length });
    return res.end(body);
  }
  res.writeHead(404);
  res.end();
}).listen(port, "127.0.0.1");
