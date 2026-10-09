import { EMPTY_PROJECT } from './store';

declare const XLSX: any;
// "><(((º> sabusabu <º)))><"

export function parseOutputCD(sheet: any) {
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const wbsGroups: any[] = [];
  const wbsItems: any[] = [];
  const articles: any[] = [];
  let currentGroupNum: number | null = null;
  let currentGroupName: string | null = null;
  let currentWbsCode: string | null = null;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const col0 = String(row[0] || "").trim();
    const col1 = String(row[1] || "").trim();
    const col2 = String(row[2] || "").trim();
    const col3 = String(row[3] || "").trim();
    const col4 = String(row[4] || "").trim();

    if (i < 7) continue;
    if (col1 === "WBS (cod)" || (col1 === "" && col2 === "" && col3 === "")) continue;

    const numVal = parseFloat(col1);
    if (!isNaN(numVal) && numVal === Math.floor(numVal) && col2 && !col2.match(/^\d{3}\s/)) {
      currentGroupNum = Math.floor(numVal);
      currentGroupName = col2;
      if (!wbsGroups.find((g) => g.number === currentGroupNum)) {
        wbsGroups.push({ number: currentGroupNum, name: currentGroupName });
      }
      continue;
    }

    if (col1 === "Somma WBS" || (typeof row[1] === "string" && String(row[1]).includes("Somma WBS"))) continue;

    const wbsMatch = col1.match(/^(\d{3}\s\d{3})$/);
    if (wbsMatch) {
      currentWbsCode = wbsMatch[1];
      if (!wbsItems.find((w) => w.code === currentWbsCode)) {
        wbsItems.push({
          code: currentWbsCode,
          groupNumber: parseInt(currentWbsCode.split(" ")[0]),
          description: "",
          articles: [],
        });
      }
      continue;
    }

    if (currentWbsCode && col2 && col2.match(/^[A-Z]/)) {
      const article = {
        id: `${currentWbsCode}|${col2}|${articles.length}`,
        wbsCode: currentWbsCode,
        code: col2,
        description: String(row[3] || "").trim().substring(0, 200),
        um: String(row[4] || "").trim(),
        budgetQuantity: parseFloat(row[5]) || 0,
        unitPrice: parseFloat(row[6]) || 0,
        revenueAmount: parseFloat(row[7]) || 0,
        cdUnit: parseFloat(row[8]) || 0,
        cdAmount: parseFloat(row[9]) || 0,
        mdc1: parseFloat(row[10]) || 0,
        mdc1Pct: parseFloat(row[11]) || 0,
        mdoUnit: parseFloat(row[13]) || 0,
        mdoAmount: parseFloat(row[14]) || 0,
        matUnit: parseFloat(row[15]) || 0,
        matAmount: parseFloat(row[16]) || 0,
        attrUnit: parseFloat(row[17]) || 0,
        attrAmount: parseFloat(row[18]) || 0,
        subUnit: parseFloat(row[19]) || 0,
        subAmount: parseFloat(row[20]) || 0,
        notes: String(row[21] || "").trim(),
        progressType: "quantity",
      };
      articles.push(article);
      const wbs = wbsItems.find((w) => w.code === currentWbsCode);
      if (wbs) {
        if (!wbs.description) wbs.description = article.description;
        wbs.articles.push(article.id);
      }
    }
  }
  return { wbsGroups, wbsItems, articles };
}

export function parseQuadroRiepilogo(sheet: any, wbsItems: any[]) {
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const col5 = String(row[5] || "").trim();
    const col6 = String(row[6] || "").trim();
    if (col5.match(/^\d{3}\s\d{3}$/) && col6) {
      const wbs = wbsItems.find((w) => w.code === col5);
      if (wbs) wbs.description = col6;
    }
  }
}

const FIELD_MAP: Record<string, RegExp> = {
  budgetQuantity: /quan|qty|q\.t|q\.?à|ore|volume|m³|mc|kg|n°|pz/i,
  unitPrice:      /p\.u\.|prezzo.?unit|unit.?price|costo.?unit/i,
  revenueAmount:  /importo|totale|ricav|valore|revenue|amount/i,
  cdAmount:       /c\.d\.|costo.?dir|direct.?cost|cd\b/i,
  um:             /\bu\.?m\.?\b|unità.?mis/i,
};

export function convertJsonToProject(raw: any, fileName: string) {
  if (raw.articles && Array.isArray(raw.articles)) return raw;

  const sheets = raw.sheets || [];
  const name = raw.summary || fileName || "Dati importati";

  const headerToField = (h: any) => {
    const s = String(h || "").toLowerCase().trim();
    for (const [field, re] of Object.entries(FIELD_MAP)) if (re.test(s)) return field;
    return null;
  };

  const isDescCol = (h: any) => /desc|attiv|voce|articolo|nome|oggetto|materiale|componente|fornitore/i.test(String(h || ""));
  const isCodeCol = (h: any) => /\bcod|^id$|^n°$|^num|^wbs/i.test(String(h || "").trim());

  const wbsGroups = [{ number: 1, name }];
  const wbsItems: any[] = [];
  const articles: any[] = [];

  sheets.forEach((sheet: any, si: number) => {
    const wbsCode = `${String(si + 1).padStart(3, "0")} 001`;
    const sheetArticles: string[] = [];
    const hdrs = sheet.headers || [];
    const descIdx = hdrs.findIndex(isDescCol);
    const codeIdx = hdrs.findIndex(isCodeCol);

    (sheet.rows || []).forEach((row: any[], ri: number) => {
      const get = (i: number) => (i >= 0 && row[i] != null ? row[i] : "");
      const parseNum = (v: any) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };

      const art: any = {
        id: `${wbsCode}|${ri}`,
        wbsCode,
        code: codeIdx >= 0 ? String(get(codeIdx)).trim() || String(ri + 1) : String(ri + 1),
        description: descIdx >= 0
          ? String(get(descIdx)).trim().substring(0, 200)
          : row.slice(0, 4).map(String).filter(Boolean).join(" — ").substring(0, 200),
        um: "", budgetQuantity: 0, unitPrice: 0, revenueAmount: 0, cdAmount: 0,
        mdc1: 0, mdc1Pct: 0, mdoUnit: 0, mdoAmount: 0, matUnit: 0, matAmount: 0,
        attrUnit: 0, attrAmount: 0, subUnit: 0, subAmount: 0,
        notes: "", progressType: "quantity",
      };

      hdrs.forEach((h: any, hi: number) => {
        const field = headerToField(h);
        if (field === "um") art.um = String(get(hi)).trim();
        else if (field) art[field] = parseNum(get(hi));
      });

      if (!art.revenueAmount && !art.cdAmount) {
        for (let hi = 0; hi < row.length; hi++) {
          if (hi === descIdx || hi === codeIdx) continue;
          const n = parseNum(row[hi]);
          if (n > 0) { art.revenueAmount = n; break; }
        }
      }

      articles.push(art);
      sheetArticles.push(art.id);
    });

    wbsItems.push({
      code: wbsCode,
      groupNumber: 1,
      description: sheet.name || `Foglio ${si + 1}`,
      articles: sheetArticles,
    });
  });

  return { ...EMPTY_PROJECT, name, wbsGroups, wbsItems, articles };
}
