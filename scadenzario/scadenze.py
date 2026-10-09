# "><(((º> sabusabu <º)))><"
"""Lettura delle scadenze "arricchite": unica fonte per app.py e notifiche.py.

Prima la query e il calcolo dello stato esistevano in due copie (una per
modulo): al primo cambio di regola le due versioni avrebbero dato risultati
diversi tra tabella e notifiche. Stato e giorni_rimanenti non sono mai salvati
nel DB: si calcolano qui a ogni lettura.
"""
from datetime import date, timedelta

# Nome soggetto per le scadenze aziendali (soggetto_tipo='azienda', soggetto_id NULL)
NOME_AZIENDA = "Cosedil S.p.A."

SQL_SCADENZE_ARRICCHITE = f"""
SELECT
  s.id, s.tipo_id, t.nome AS tipo_nome, t.categoria,
  s.soggetto_tipo, s.soggetto_id,
  CASE s.soggetto_tipo
    WHEN 'dipendente'     THEN COALESCE(d.nome || ' ' || d.cognome, '(dipendente eliminato)')
    WHEN 'subappaltatore' THEN COALESCE(sub.ragione_sociale, '(subappaltatore eliminato)')
    WHEN 'attrezzatura'   THEN COALESCE(
        a.descrizione || CASE
          WHEN a.matricola IS NOT NULL AND a.matricola <> '' THEN ' (' || a.matricola || ')'
          ELSE '' END,
        '(attrezzatura eliminata)')
    WHEN 'sistema_ia'     THEN COALESCE(si.nome, '(sistema IA eliminato)')
    ELSE '{NOME_AZIENDA}'
  END AS soggetto_nome,
  CASE s.soggetto_tipo
    WHEN 'dipendente'   THEN d.cantiere
    WHEN 'attrezzatura' THEN a.cantiere
    WHEN 'sistema_ia'   THEN si.cantiere
    ELSE NULL
  END AS cantiere,
  -- 0 = soggetto disattivato in anagrafica: niente avvisi per chi non c'è più
  CASE s.soggetto_tipo
    WHEN 'dipendente'     THEN d.attivo
    WHEN 'subappaltatore' THEN sub.attivo
    WHEN 'attrezzatura'   THEN a.attivo
    WHEN 'sistema_ia'     THEN si.attivo
    ELSE 1
  END AS soggetto_attivo,
  s.data_rilascio, s.data_scadenza, s.documento_rif, s.referente, s.note, s.chiusa,
  t.preavviso_giorni,
  (SELECT COUNT(*) FROM adempimenti ad WHERE ad.scadenza_id = s.id) AS adempimenti_totali,
  (SELECT COUNT(*) FROM adempimenti ad WHERE ad.scadenza_id = s.id AND ad.fatto = 1) AS adempimenti_fatti,
  (SELECT COUNT(*) FROM allegati al WHERE al.scadenza_id = s.id) AS allegati_totali
FROM scadenze s
JOIN tipi_scadenza t ON t.id = s.tipo_id
LEFT JOIN dipendenti d       ON s.soggetto_tipo = 'dipendente'     AND d.id   = s.soggetto_id
LEFT JOIN subappaltatori sub ON s.soggetto_tipo = 'subappaltatore' AND sub.id = s.soggetto_id
LEFT JOIN attrezzature a     ON s.soggetto_tipo = 'attrezzatura'   AND a.id   = s.soggetto_id
LEFT JOIN sistemi_ia si      ON s.soggetto_tipo = 'sistema_ia'     AND si.id  = s.soggetto_id
"""


def calcola_stato(data_scadenza: str, chiusa, preavviso_giorni, oggi: date) -> tuple:
    """(stato, giorni_rimanenti) secondo le regole della SPEC."""
    scad = date.fromisoformat(data_scadenza)
    giorni = (scad - oggi).days
    if chiusa:
        return "chiusa", giorni
    if scad < oggi:
        return "scaduta", giorni
    if scad <= oggi + timedelta(days=preavviso_giorni or 0):
        return "in_scadenza", giorni
    return "valida", giorni


def arricchisci_riga(riga, oggi: date) -> dict:
    """Riga della query arricchita -> dict con stato e giorni_rimanenti."""
    s = dict(riga)
    s["stato"], s["giorni_rimanenti"] = calcola_stato(
        s["data_scadenza"], s["chiusa"], s.get("preavviso_giorni"), oggi)
    return s


def carica(conn, where: str = "", parametri: tuple = (), oggi: date | None = None) -> list[dict]:
    """Scadenze arricchite (ordinamento data_scadenza ASC)."""
    sql = SQL_SCADENZE_ARRICCHITE
    if where:
        sql += f" WHERE {where}"
    sql += " ORDER BY s.data_scadenza ASC, s.id ASC"
    oggi = oggi or date.today()
    return [arricchisci_riga(r, oggi) for r in conn.execute(sql, parametri).fetchall()]
