// "><(((º> sabusabu <º)))><"
"use strict";

// Generazione file .stamp (OpenText IGCMarkupStamp) da PNG.
// Condiviso tra la pagina web (script classico) e la CLI Node (timbro.js).
// Unita' del formato: 1 unita' = 0.001 pollici (stamptoinches=0.001).
// La scala dell'immagine = 1000 / dpi (a 96 dpi => 10.4166...).

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS_BY_COLOR_TYPE = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]);

function readPngInfo(data) {
  if (data.length < 26 || !PNG_SIGNATURE.every((byte, index) => data[index] === byte)) {
    throw new Error("il file non ha un'intestazione PNG valida");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const bitDepth = view.getUint8(24);
  const channels = CHANNELS_BY_COLOR_TYPE.get(view.getUint8(25));

  if (!width || !height || !channels) throw new Error("il file contiene dimensioni o tipo colore non validi");
  return { width, height, bitDepth: bitDepth * channels };
}

function xmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value) {
  return String(Number(value));
}

function buildStamp(data, name, settings) {
  const { width, height, bitDepth } = readPngInfo(data);
  const scale = 1000 / settings.dpi;
  const imageGuid = crypto.randomUUID().replaceAll("-", "").toUpperCase();
  const elementGuid = crypto.randomUUID().replaceAll("-", "").toUpperCase();
  const now = Math.floor(Date.now() / 1000);
  const base64 = btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(""));
  const right = settings.x + width * scale;
  const top = settings.y + height * scale;

  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` +
    `<IGCMarkupStamp xmlns="http://www.opentext.com" majorversion="2" minorversion="13" revision="0">` +
    `<CDLInfo v1="5" v2="3" v3="0" v4="99"><DriverInfo>Pdf2dl</DriverInfo>` +
    `<DriverFormatVersion>1</DriverFormatVersion></CDLInfo>` +
    `<ImageList><Image guid="${imageGuid}" name="${xmlAttribute(name)}" bitdepth="${bitDepth}" ` +
    `encoding="base64" mimetype="image/png" bytesize="${data.length}">${base64}</Image></ImageList>` +
    `<Stamp left="0" bottom="0" right="${formatNumber(right)}" top="${formatNumber(top)}" ` +
    `stamptoinches="0.001" pageheightinches="${formatNumber(settings.pageHeight)}">` +
    `<Matrix>1|0|0|1|0|0</Matrix><Elements>` +
    `<Raster id="1" guid="${elementGuid}" time="${now}" creationtime="${now}" hyperlink="" comment="">` +
    `${imageGuid}<Matrix>${formatNumber(scale)}|0|0|${formatNumber(scale)}|${formatNumber(settings.x)}|${formatNumber(settings.y)}</Matrix><MetaData/></Raster>` +
    `</Elements></Stamp></IGCMarkupStamp>`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { readPngInfo, buildStamp };
}
