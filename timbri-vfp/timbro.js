#!/usr/bin/env node
// "><(((º> sabusabu <º)))><"
"use strict";

// timbro.js - crea file .stamp (OpenText IGCMarkupStamp) da un'immagine PNG.
//
// Uso:
//   node timbro.js firma.png                      -> firma.stamp
//   node timbro.js firma.png -o Timbro.stamp --x 2138 --y 1528 --dpi 96
//   node timbro.js a.png b.png                    -> a.stamp, b.stamp

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs } = require("node:util");
const { buildStamp } = require("./stamp.js");

const USAGE = `Crea file .stamp da immagini PNG

Uso: node timbro.js IMMAGINE.png [...] [opzioni]

  -o, --output FILE    file di uscita (solo con un'immagine)
  --x N                posizione X (millesimi di pollice, default 0)
  --y N                posizione Y (millesimi di pollice, default 0)
  --dpi N              risoluzione dell'immagine (default 96)
  --page-height N      altezza pagina in pollici (default A4 = 11.68)
  -h, --help           mostra questo aiuto`;

function fail(text) {
  console.error(`${USAGE}\n\ntimbro.js: errore: ${text}`);
  process.exit(2);
}

function readNumber(values, key, fallback) {
  if (values[key] === undefined) return fallback;
  const value = Number(values[key]);
  if (values[key].trim() === "" || !Number.isFinite(value)) fail(`--${key}: numero non valido '${values[key]}'`);
  return value;
}

// parseArgs rifiuta "--x -5": unisce opzione e valore negativo in "--x=-5", come accetta argparse.
function joinNegativeValues(args) {
  const joined = [];
  for (let i = 0; i < args.length; i++) {
    if (/^--(x|y|dpi|page-height)$/.test(args[i]) && /^-\d|^-\.\d/.test(args[i + 1] ?? "")) {
      joined.push(`${args[i]}=${args[++i]}`);
    } else {
      joined.push(args[i]);
    }
  }
  return joined;
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      args: joinNegativeValues(process.argv.slice(2)),
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        x: { type: "string" },
        y: { type: "string" },
        dpi: { type: "string" },
        "page-height": { type: "string" },
        help: { type: "boolean", short: "h" }
      }
    });
  } catch (error) {
    fail(error.message);
  }
  const { values, positionals: images } = parsed;

  if (values.help) {
    console.log(USAGE);
    return;
  }
  if (images.length === 0) fail("indica almeno un file PNG");
  if (values.output && images.length > 1) fail("--output si usa con una sola immagine");

  const settings = {
    x: readNumber(values, "x", 0),
    y: readNumber(values, "y", 0),
    dpi: readNumber(values, "dpi", 96),
    pageHeight: readNumber(values, "page-height", 11.68060055479873)
  };

  for (const image of images) {
    const parsedPath = path.parse(image);
    const out = values.output || path.join(parsedPath.dir, `${parsedPath.name}.stamp`);
    const data = fs.readFileSync(image);
    fs.writeFileSync(out, buildStamp(data, parsedPath.base, settings), "utf8");
    console.log(`creato: ${out}`);
  }
}

main();
