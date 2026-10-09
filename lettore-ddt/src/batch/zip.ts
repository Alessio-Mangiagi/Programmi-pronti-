// zip.ts — Scrittore ZIP minimale (deflate) su zlib built-in.
//
// Serve alla pagina "Conversione automatica" quando il browser non può scrivere
// da solo nella cartella scelta (nessuna File System Access API): 50 Excel
// scaricati uno per uno fanno 50 richieste di download, un .zip ne fa una.
// Il pacchetto `archiver`/`jszip` non è installabile per via del proxy
// aziendale (vedi la nota su zlib in system.routes.ts), quindi lo formattiamo
// a mano: solo file, nessuna cartella, nessuna cifratura, nessun zip64.

import zlib from 'zlib';

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const END_OF_CENTRAL_SIG = 0x06054b50;
// 20 = "2.0", la versione che introduce deflate: il minimo che sappia aprirci.
const VERSION_NEEDED = 20;
const METHOD_DEFLATE = 8;
// Bit 11: i nomi file sono UTF-8 (senza, i caratteri accentati si rompono).
const FLAG_UTF8 = 0x800;
// Zip64 parte a 4GiB: oltre, i campi a 32 bit dell'header non bastano più.
const MAX_ZIP_BYTES = 0xffffffff;

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** Data di modifica scritta nell'archivio (default: adesso). */
  date?: Date;
}

// Data/ora in formato MS-DOS: il campo dello ZIP originale, secondi a passi di 2.
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Crea un archivio ZIP in memoria. Adatto a decine di Excel (pochi MB); per
 * volumi molto maggiori servirebbe uno stream su disco.
 */
export function createZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data, { level: 6 });
    const crc = crc32(entry.data);
    const { time, date } = dosDateTime(entry.date || new Date());

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // "><(((º> sabusabu <º)))><"
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION_NEEDED, 4); // version made by
    central.writeUInt16LE(VERSION_NEEDED, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field
    central.writeUInt16LE(0, 32); // commento
    central.writeUInt16LE(0, 34); // disco
    central.writeUInt16LE(0, 36); // attributi interni
    central.writeUInt32LE(0, 38); // attributi esterni
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, compressed);
    centrals.push(central);
    offset += local.length + compressed.length;
    if (offset > MAX_ZIP_BYTES) {
      throw new Error('archivio oltre 4GB: serve zip64, scarica gli Excel in più riprese');
    }
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_SIG, 0);
  end.writeUInt16LE(0, 4); // numero disco
  end.writeUInt16LE(0, 6); // disco con la directory centrale
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // commento

  return Buffer.concat([...locals, ...centrals, end]);
}

// CRC-32 (IEEE 802.3), tabella calcolata una volta sola.
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
