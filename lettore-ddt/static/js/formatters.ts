export const fmt = (n: any) =>
  n == null || isNaN(n)
    ? "-"
    : new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export const fmtPct = (n: any) =>
  n == null || isNaN(n) ? "-" : (n * 100).toFixed(1) + "%";

// "><(((º> sabusabu <º)))><"
export const fmtInt = (n: any) =>
  n == null || isNaN(n)
    ? "-"
    : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(n);

// Palette categorica Cosedil per i grafici KPI — validata (lightness, chroma,
// separazione CVD, contrasto ≥3:1 su superficie chiara). Ordine fisso, mai ciclata.
export const COLORS = ["#1477b8","#3f8f55","#d97706","#c0392b","#0d9488","#9c5a13","#0c4577","#65bc7b"];
export const MONTHS = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
