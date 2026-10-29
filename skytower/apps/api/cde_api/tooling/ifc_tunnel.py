# "><(((º> sabusabu <º)))><"
"""Modello IFC4 di una galleria stradale a due corsie, per provare il viewer BIM su un'opera infrastrutturale.

Galleria naturale con imbocchi in artificiale, divisa in conci da 12 m lungo l'asse (Y). Per ogni concio: arco
rovescio, rivestimento definitivo (piedritti e calotta, profilo a ferro di cavallo estruso), pavimentazione
stradale, marciapiedi, canalette di drenaggio, corpi illuminanti in calotta; ogni 4 conci una coppia di
ventilatori a getto; nicchie SOS ogni 150 m circa; agli imbocchi portali e muri d'ala. Le tratte (imbocco nord,
naturale, imbocco sud) sono i "piani" del modello (IfcBuildingStorey a quota 0), così il viewer le elenca e il
derivato .glb si divide per tratta. Proprietà con progressiva, concio, classe del calcestruzzo; quantità.
IFC4 e non IFC4x3 (IfcTunnel non è ancora nello standard): la galleria è un IfcBuilding con ObjectType.
Uscita deterministica (GUID da un seme).
"""
from __future__ import annotations

import math

from .ifc_complex import _f, _label, _Model, _ql, _qv, _ref, _txt

CONCIO = 12.0           # lunghezza di un concio (m)
R_OUT, R_IN = 6.3, 5.75  # raggi esterno e interno del rivestimento (m)
SPRING = 1.6             # quota d'imposta dell'arco rispetto al piano viabile (m)


def _pk(y: float) -> str:
    return f"{int(y // 1000)}+{int(y % 1000):03d}"


def _style(m: _Model, name: str, r: float, g: float, b: float, transparency: float = 0.) -> int:
    w = m.w
    rgb = w.add(f"IFCCOLOURRGB($,{_f(r)},{_f(g)},{_f(b)})")
    rend = w.add(f"IFCSURFACESTYLERENDERING(#{rgb},{_f(transparency)},$,$,$,$,$,$,.FLAT.)")
    return w.add(f"IFCSURFACESTYLE({_txt(name)},.BOTH.,(#{rend}))")


def _along_y(m: _Model, points: list[tuple[float, float]], length: float) -> int:
    """Profilo chiuso nel piano XZ (x, z) estruso per `length` lungo +Y dall'origine dell'elemento."""
    w = m.w
    pts = [w.add(f"IFCCARTESIANPOINT(({_f(x)},{_f(z)}))") for x, z in points]
    poly = w.add(f"IFCPOLYLINE({_ref(pts + [pts[0]])})")
    prof = w.add(f"IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#{poly})")
    # asse di estrusione −Y con riferimento X: la y del profilo diventa la Z del mondo; si parte da y = length
    o = w.add(f"IFCCARTESIANPOINT((0.,{_f(length)},0.))")
    axis = w.add("IFCDIRECTION((0.,-1.,0.))")
    pos = w.add(f"IFCAXIS2PLACEMENT3D(#{o},#{axis},#{m.x})")
    return w.add(f"IFCEXTRUDEDAREASOLID(#{prof},#{pos},#{m.z},{_f(length)})")


def _ring(steps: int = 24) -> list[tuple[float, float]]:
    """Rivestimento: piedritti verticali fino all'imposta, poi calotta semicircolare; spessore R_OUT − R_IN."""
    outer = [(R_OUT * math.cos(math.pi * i / steps), SPRING + R_OUT * math.sin(math.pi * i / steps)) for i in range(steps + 1)]
    inner = [(R_IN * math.cos(math.pi * i / steps), SPRING + R_IN * math.sin(math.pi * i / steps)) for i in range(steps + 1)]
    return [(R_OUT, 0.), *outer, (-R_OUT, 0.), (-R_IN, 0.), *reversed(inner), (R_IN, 0.)]


def build(lunghezza: float = 480.0, seed: int = 141) -> bytes:
    """Il file .ifc (STEP, IFC4) come bytes. `lunghezza` in metri, arrotondata ai conci."""
    m = _Model(seed, "141-103-2 - Galleria Fortolese", "Modello BIM della galleria stradale (prova CDE)")
    w = m.w
    concrete = _style(m, "Calcestruzzo", 0.72, 0.72, 0.70)
    lining = _style(m, "Rivestimento", 0.82, 0.80, 0.76)
    asphalt = _style(m, "Conglomerato bituminoso", 0.18, 0.18, 0.2)
    kerb = _style(m, "Marciapiede", 0.62, 0.62, 0.6)
    lamp = _style(m, "Corpo illuminante", 1.0, 0.85, 0.3)
    fan = _style(m, "Ventilatore", 0.3, 0.32, 0.36)
    sos = _style(m, "Nicchia SOS", 0.1, 0.45, 0.85)

    n = max(4, round(lunghezza / CONCIO))
    length = n * CONCIO
    site_pl = m.placement(None)
    site = w.add(f"IFCSITE('{w.guid()}',$,'Lotto 141-103-2',$,$,#{site_pl},$,$,.ELEMENT.,$,$,$,$,$)")
    w.add(f"IFCRELAGGREGATES('{w.guid()}',$,$,$,#{m.project},(#{site}))")
    gal_pl = m.placement(site_pl)
    gal = w.add(f"IFCBUILDING('{w.guid()}',$,'Galleria Fortolese','Galleria stradale a due corsie',$,#{gal_pl},$,$,"
                ".ELEMENT.,$,$,$)")
    w.add(f"IFCRELAGGREGATES('{w.guid()}',$,$,$,#{site},(#{gal}))")

    imbocco = 3                                                     # conci in artificiale per imbocco
    tratte = [("Imbocco Nord", 0, imbocco), ("Tratta in naturale", imbocco, n - imbocco), ("Imbocco Sud", n - imbocco, n)]
    storeys = []
    for name, a, b in tratte:
        st_pl = m.placement(gal_pl)
        label = f"{name} (pk {_pk(a * CONCIO)} – {_pk(b * CONCIO)})"
        st = w.add(f"IFCBUILDINGSTOREY('{w.guid()}',$,{_txt(label)},$,$,#{st_pl},$,$,.ELEMENT.,0.)")
        storeys.append(st)
        elems: list[int] = []
        for k in range(a, b):
            elems += _concio(m, st_pl, k, natural=name.startswith("Tratta"),
                             styles=(concrete, lining, asphalt, kerb, lamp, fan, sos))
        if a == 0:
            elems += _imbocco(m, st_pl, 0., "Nord", concrete, toward=-1)
        if b == n:
            elems += _imbocco(m, st_pl, length, "Sud", concrete, toward=1)
        w.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{w.guid()}',$,$,$,{_ref(elems)},#{st})")
    w.add(f"IFCRELAGGREGATES('{w.guid()}',$,$,$,#{gal},{_ref(storeys)})")
    m.finish()
    head = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');\n"
            "FILE_NAME('galleria-fortolese.ifc','2026-10-29T12:00:00',('CDE SkyTower'),('Nexora'),"
            "'cde genera-galleria','CDE SkyTower','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n")
    return (head + "\n".join(w.lines) + "\nENDSEC;\nEND-ISO-10303-21;\n").encode("utf-8")


def _el(m: _Model, entity: str, name: str, pl_parent: int, pos, solids: list[int], style: int,
        predefined: str = "$", object_type: str = "$") -> int:
    w = m.w
    pl = m.placement(pl_parent, *pos)
    shape = m.shape(solids, style)
    return w.add(f"{entity}('{w.guid()}',$,{_txt(name)},$,{object_type},#{pl},#{shape},$,{predefined})")


def _concio(m: _Model, st_pl: int, k: int, *, natural: bool, styles) -> list[int]:
    concrete, lining, asphalt, kerb, lamp, fan, sos = styles
    y = k * CONCIO
    tag = f"C{k + 1:03d}"
    pk = _pk(y)
    out: list[int] = []

    def props(e: int, kind: str, cls: str | None = None, extra: list[tuple[str, str]] = ()):
        p = [("Concio", _label(tag)), ("Progressiva", _label(pk)), ("Elemento", _label(kind)),
             ("Metodo di scavo", _label("Tradizionale (NATM)" if natural else "Artificiale"))]
        if cls:
            p.append(("Classe calcestruzzo", _label(cls)))
        m.pset("Pset_CDE_Galleria", [e], [*p, *extra])

    # arco rovescio e pavimentazione
    inv = _el(m, "IFCSLAB", f"Arco rovescio {tag}", st_pl, (0., y, 0.),
              [m.box_solid(2 * R_OUT, CONCIO, 0.9, -R_OUT, 0., -1.2)], concrete, ".BASESLAB.")
    m.material("Calcestruzzo C25/30", inv)
    props(inv, "Arco rovescio", "C25/30")
    m.pset("Qto_SlabBaseQuantities", [inv], [("Width", _ql(2 * R_OUT)), ("Length", _ql(CONCIO)),
                                            ("NetVolume", _qv(2 * R_OUT * CONCIO * 0.9))])
    pav = _el(m, "IFCSLAB", f"Pavimentazione stradale {tag}", st_pl, (0., y, 0.),
              [m.box_solid(9.5, CONCIO, 0.3, -4.75, 0., -0.3)], asphalt, ".FLOOR.")
    m.material("Conglomerato bituminoso", pav)
    props(pav, "Pavimentazione", extra=[("Corsie", "IFCINTEGER(2)")])
    out += [inv, pav]

    # rivestimento definitivo (piedritti + calotta)
    ring = _el(m, "IFCBUILDINGELEMENTPROXY", f"Rivestimento definitivo {tag}", st_pl, (0., y, 0.),
               [_along_y(m, _ring(), CONCIO)], lining, ".ELEMENT.", "'Rivestimento definitivo'")
    m.material("Calcestruzzo C30/37 fibrorinforzato", ring)
    props(ring, "Rivestimento definitivo", "C30/37", [("Spessore", f"IFCLENGTHMEASURE({_f(R_OUT - R_IN)})")])
    area = math.pi * (R_OUT ** 2 - R_IN ** 2) / 2 + 2 * SPRING * (R_OUT - R_IN)
    m.pset("Qto_BuildingElementProxyQuantities", [ring], [("NetVolume", _qv(area * CONCIO))])
    out.append(ring)

    # marciapiedi e canalette
    for side, x0 in (("Ovest", -R_IN), ("Est", 4.75)):
        mp = _el(m, "IFCBUILDINGELEMENTPROXY", f"Marciapiede {side} {tag}", st_pl, (0., y, 0.),
                 [m.box_solid(R_IN - 4.75, CONCIO, 0.25, x0, 0., -0.3)], kerb, ".ELEMENT.", "'Marciapiede'")
        m.material("Calcestruzzo C25/30", mp)
        props(mp, "Marciapiede", "C25/30")
        dr = _el(m, "IFCPIPESEGMENT", f"Canaletta di drenaggio {side} {tag}", st_pl, (0., y, 0.),
                 [m.box_solid(0.3, CONCIO, 0.3, (-4.75 if side == "Ovest" else 4.45), 0., -0.6)], concrete, ".GUTTER.")
        props(dr, "Canaletta di drenaggio")
        out += [mp, dr]

    # illuminazione in calotta (due file)
    for side, x in (("sx", -2.2), ("dx", 2.2)):
        lt = _el(m, "IFCLIGHTFIXTURE", f"Corpo illuminante {side} {tag}", st_pl, (x, y + CONCIO / 2, SPRING + 4.8),
                 [m.box_solid(0.5, 1.2, 0.15, -0.25, -0.6, 0.)], lamp, ".DIRECTIONSOURCE.")
        props(lt, "Illuminazione", extra=[("Potenza", "IFCPOWERMEASURE(150.)")])
        out.append(lt)

    # ventilatori a getto ogni 4 conci, nella tratta in naturale
    if natural and k % 4 == 2:
        for side, x in (("sx", -2.6), ("dx", 2.6)):
            def jet(x=x):
                w = m.w
                c = w.add("IFCCARTESIANPOINT((0.,0.))")
                circ = w.add(f"IFCCIRCLEPROFILEDEF(.AREA.,$,#{w.add(f'IFCAXIS2PLACEMENT2D(#{c},$)')},0.6)")
                o = w.add("IFCCARTESIANPOINT((0.,2.,0.))")
                axis = w.add("IFCDIRECTION((0.,-1.,0.))")
                pos = w.add(f"IFCAXIS2PLACEMENT3D(#{o},#{axis},#{m.x})")
                return [w.add(f"IFCEXTRUDEDAREASOLID(#{circ},#{pos},#{m.z},4.)")]
            f = _el(m, "IFCFAN", f"Ventilatore a getto {side} {tag}", st_pl, (x, y + CONCIO / 2, SPRING + 3.4),
                    jet(), fan, ".TUBEAXIAL.")
            props(f, "Ventilazione", extra=[("Spinta", "IFCFORCEMEASURE(1100.)")])
            out.append(f)

    # nicchia SOS circa ogni 150 m (lato est)
    if natural and k % 12 == 6:
        s = _el(m, "IFCBUILDINGELEMENTPROXY", f"Nicchia SOS {tag}", st_pl, (R_IN - 0.4, y + 4., 0.),
                [m.box_solid(0.4, 2.5, 2.4, 0., 0., 0.)], sos, ".ELEMENT.", "'Nicchia SOS'")
        props(s, "Nicchia SOS", extra=[("Dotazioni", _label("Telefono SOS, estintori, pulsante allarme"))])
        out.append(s)
    return out


def _imbocco(m: _Model, st_pl: int, y: float, side: str, concrete: int, toward: int) -> list[int]:
    """Portale (becco di flauto semplificato: cornice in c.a.) e due muri d'ala."""
    out = []
    thick = 1.0
    y0 = y if toward > 0 else y - thick
    portal = _el(m, "IFCWALL", f"Portale imbocco {side}", st_pl, (0., y0, 0.),
                 [m.box_solid(1.4, thick, SPRING + R_OUT + 1., R_OUT, 0., -1.2),
                  m.box_solid(1.4, thick, SPRING + R_OUT + 1., -R_OUT - 1.4, 0., -1.2),
                  m.box_solid(2 * R_OUT + 2.8, thick, 1.2, -R_OUT - 1.4, 0., SPRING + R_OUT)],
                 concrete, ".SOLIDWALL.")
    m.material("Calcestruzzo C30/37", portal)
    m.pset("Pset_WallCommon", [portal], [("IsExternal", "IFCBOOLEAN(.T.)"), ("LoadBearing", "IFCBOOLEAN(.T.)")])
    m.pset("Pset_CDE_Galleria", [portal], [("Elemento", _label("Portale")), ("Progressiva", _label(_pk(y)))])
    out.append(portal)
    for wing, x0 in (("ovest", -R_OUT - 1.4 - 0.8), ("est", R_OUT + 1.4)):
        yw = y0 + (thick if toward > 0 else -10.)
        wl = _el(m, "IFCWALL", f"Muro d'ala {wing} imbocco {side}", st_pl, (0., yw, 0.),
                 [m.box_solid(0.8, 10., 5.5, x0, 0., -1.2)], concrete, ".SOLIDWALL.", "'Muro d''ala'")
        m.material("Calcestruzzo C30/37", wl)
        m.pset("Pset_CDE_Galleria", [wl], [("Elemento", _label("Muro d'ala")), ("Progressiva", _label(_pk(y)))])
        out.append(wl)
    return out
