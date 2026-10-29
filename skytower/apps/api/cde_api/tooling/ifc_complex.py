# "><(((º> sabusabu <º)))><"
"""Modello IFC4 "complesso" per provare il viewer BIM: un padiglione ospedaliero di sei livelli.

Per ogni livello (interrato, terra, 1, 2, 3) solaio, griglia di pilastri e travi, muri perimetrali con
finestre in aperture vere (IfcOpeningElement + IfcRelVoidsElement/IfcRelFillsElement), corridoio con porte,
tramezzi, ambienti (IfcSpace), arredi nei primi piani; scala in cemento con ringhiera; in copertura solaio,
parapetti e locale tecnico; all'ingresso una pensilina ruotata di 15° (prova delle misure nel sistema locale).
Proprietà (Pset_*Common e un Pset CDE con il codice elemento), quantità (Qto_*BaseQuantities), materiali e
vetri trasparenti. I nomi dei muri ("Muro perimetrale sud P0", ...) sono quelli citati dalle tavole demo.

`padiglioni` > 1 affianca più edifici sullo stesso sito, per le prove di carico del viewer.
Uscita deterministica (GUID da un seme): rigenerare dà lo stesso file.
"""
from __future__ import annotations

import math
import random
import uuid

ROOMS = ["Ambulatorio", "Studio medico", "Sala attesa", "Degenza", "Ufficio", "Deposito", "Sala riunioni",
         "Laboratorio", "Spogliatoio", "Servizi"]
_B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"


def ifc_guid(u: uuid.UUID) -> str:
    """GlobalId IFC: l'UUID in 22 caratteri base 64 (alfabeto IFC), come lo scrivono i software BIM."""
    n = u.int
    return "".join(_B64[(n >> (6 * i)) & 63] for i in reversed(range(22)))


class _Writer:
    def __init__(self, seed: int):
        self.lines: list[str] = []
        self.n = 0
        self.rnd = random.Random(seed)

    def add(self, text: str) -> int:
        self.n += 1
        self.lines.append(f"#{self.n}={text};")
        return self.n

    def guid(self) -> str:
        return ifc_guid(uuid.UUID(int=self.rnd.getrandbits(128)))


def _f(v: float) -> str:
    s = f"{v:.4f}".rstrip("0")
    return s + "0" if s.endswith(".") else s


def _ref(ids) -> str:
    return "(" + ",".join(f"#{i}" for i in ids) + ")"


def _txt(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


class _Model:
    """Entità condivise (contesti, direzioni, stili, materiali) e costruttori di elementi."""

    def __init__(self, seed: int, name: str = "Nuovo Ospedale Nord",
                 description: str = "Modello architettonico e strutturale di prova"):
        w = self.w = _Writer(seed)
        self.origin = w.add("IFCCARTESIANPOINT((0.,0.,0.))")
        self.z = w.add("IFCDIRECTION((0.,0.,1.))")
        self.x = w.add("IFCDIRECTION((1.,0.,0.))")
        self.world = w.add(f"IFCAXIS2PLACEMENT3D(#{self.origin},$,$)")
        ctx = w.add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#{self.world},$)")
        self.body = w.add(f"IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#{ctx},$,.MODEL_VIEW.,$)")
        units = [w.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"), w.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
                 w.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"), w.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)")]
        ua = w.add(f"IFCUNITASSIGNMENT({_ref(units)})")
        self.project = w.add(f"IFCPROJECT('{w.guid()}',$,{_txt(name)},{_txt(description)},$,$,$,(#{ctx}),#{ua})")
        rgb = w.add("IFCCOLOURRGB($,0.55,0.75,0.9)")
        rend = w.add(f"IFCSURFACESTYLERENDERING(#{rgb},0.6,$,$,$,$,$,$,.FLAT.)")
        self.glass = w.add(f"IFCSURFACESTYLE('Vetro',.BOTH.,(#{rend}))")
        self.materials: dict[str, int] = {}
        self.material_of: dict[str, list[int]] = {}
        self.psets: list[tuple[str, list[int], list[tuple[str, str]]]] = []

    # --- geometria -------------------------------------------------------
    def placement(self, parent: int | None, x=0., y=0., z=0., angle: float = 0.) -> int:
        w = self.w
        pt = w.add(f"IFCCARTESIANPOINT(({_f(x)},{_f(y)},{_f(z)}))")
        if angle:
            d = w.add(f"IFCDIRECTION(({_f(math.cos(angle))},{_f(math.sin(angle))},0.))")
            ax = w.add(f"IFCAXIS2PLACEMENT3D(#{pt},#{self.z},#{d})")
        else:
            ax = w.add(f"IFCAXIS2PLACEMENT3D(#{pt},$,$)")
        return w.add(f"IFCLOCALPLACEMENT({'$' if parent is None else f'#{parent}'},#{ax})")

    def box_solid(self, dx: float, dy: float, dz: float, ox=0., oy=0., oz=0.) -> int:
        """Parallelepipedo da (ox,oy,oz) a (ox+dx, oy+dy, oz+dz) nel sistema dell'elemento."""
        w = self.w
        c = w.add(f"IFCCARTESIANPOINT(({_f(dx / 2)},{_f(dy / 2)}))")
        ax2 = w.add(f"IFCAXIS2PLACEMENT2D(#{c},$)")
        prof = w.add(f"IFCRECTANGLEPROFILEDEF(.AREA.,$,#{ax2},{_f(dx)},{_f(dy)})")
        pos = self.world
        if ox or oy or oz:
            p = w.add(f"IFCCARTESIANPOINT(({_f(ox)},{_f(oy)},{_f(oz)}))")
            pos = w.add(f"IFCAXIS2PLACEMENT3D(#{p},$,$)")
        return w.add(f"IFCEXTRUDEDAREASOLID(#{prof},#{pos},#{self.z},{_f(dz)})")

    def shape(self, solids: list[int], style: int | None = None) -> int:
        w = self.w
        if style:
            for s in solids:
                w.add(f"IFCSTYLEDITEM(#{s},(#{style}),$)")
        rep = w.add(f"IFCSHAPEREPRESENTATION(#{self.body},'Body','SweptSolid',{_ref(solids)})")
        return w.add(f"IFCPRODUCTDEFINITIONSHAPE($,$,(#{rep}))")

    # --- semantica -------------------------------------------------------
    def material(self, name: str, elem: int) -> None:
        self.material_of.setdefault(name, []).append(elem)

    def pset(self, name: str, elems: list[int], props: list[tuple[str, str]]) -> None:
        self.psets.append((name, elems, props))

    def finish(self) -> None:
        w = self.w
        for name, elems in self.material_of.items():
            m = w.add(f"IFCMATERIAL({_txt(name)},$,$)")
            w.add(f"IFCRELASSOCIATESMATERIAL('{w.guid()}',$,$,$,{_ref(elems)},#{m})")
        for name, elems, props in self.psets:
            if name.startswith("Qto_"):
                q = [w.add(v.format(k=_txt(k))) for k, v in props]
                ps = w.add(f"IFCELEMENTQUANTITY('{w.guid()}',$,{_txt(name)},$,$,{_ref(q)})")
            else:
                p = [w.add(f"IFCPROPERTYSINGLEVALUE({_txt(k)},$,{v},$)") for k, v in props]
                ps = w.add(f"IFCPROPERTYSET('{w.guid()}',$,{_txt(name)},$,{_ref(p)})")
            w.add(f"IFCRELDEFINESBYPROPERTIES('{w.guid()}',$,$,$,{_ref(elems)},#{ps})")


def _ql(v: float) -> str:
    return f"IFCQUANTITYLENGTH({{k}},$,$,{_f(v)},$)"


def _qa(v: float) -> str:
    return f"IFCQUANTITYAREA({{k}},$,$,{_f(v)},$)"


def _qv(v: float) -> str:
    return f"IFCQUANTITYVOLUME({{k}},$,$,{_f(v)},$)"


def _bool(b: bool) -> str:
    return "IFCBOOLEAN(.T.)" if b else "IFCBOOLEAN(.F.)"


def _label(s: str) -> str:
    return f"IFCLABEL({_txt(s)})"


def build(padiglioni: int = 1, seed: int = 7) -> bytes:
    """Il file .ifc (STEP, IFC4) come bytes."""
    m = _Model(seed)
    w = m.w
    site_pl = m.placement(None)
    site = w.add(f"IFCSITE('{w.guid()}',$,'Lotto ospedaliero',$,$,#{site_pl},$,$,.ELEMENT.,$,$,$,$,$)")
    w.add(f"IFCRELAGGREGATES('{w.guid()}',$,$,$,#{m.project},(#{site}))")
    buildings = []
    for b in range(padiglioni):
        name = "Padiglione B" if padiglioni == 1 else f"Padiglione {chr(ord('B') + b)}"
        buildings.append(_building(m, site_pl, name, b, offset_x=b * 50.))
    w.add(f"IFCRELAGGREGATES('{w.guid()}',$,$,$,#{site},{_ref(buildings)})")
    m.finish()
    head = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');\n"
            "FILE_NAME('ospedale-complesso.ifc','2026-10-28T12:00:00',('CDE SkyTower'),('Nexora'),"
            "'cde genera-ifc','CDE SkyTower','');\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n")
    return (head + "\n".join(w.lines) + "\nENDSEC;\nEND-ISO-10303-21;\n").encode("utf-8")


def _building(m: _Model, site_pl: int, name: str, b: int, offset_x: float) -> int:
    w = m.w
    bx, by, span = 6, 3, 6.0                               # campate: 6 lungo X, 3 lungo Y, da 6 m
    lx, ly, h = bx * span, by * span, 3.6
    bld_pl = m.placement(site_pl, offset_x, 0., 0.)
    bld = w.add(f"IFCBUILDING('{w.guid()}',$,{_txt(name)},'Corpo degenze e ambulatori',$,#{bld_pl},$,$,.ELEMENT.,$,$,$)")
    levels = [("Piano interrato", -h, "PI"), ("Piano terra", 0., "P0"), ("Piano 1", h, "P1"),
              ("Piano 2", 2 * h, "P2"), ("Piano 3", 3 * h, "P3")]
    storeys = []
    for idx, (sname, elev, tag) in enumerate(levels):
        st_pl = m.placement(bld_pl, 0., 0., elev)
        st = w.add(f"IFCBUILDINGSTOREY('{w.guid()}',$,{_txt(sname)},$,$,#{st_pl},$,$,.ELEMENT.,{_f(elev)})")
        storeys.append(st)
        elems = _storey(m, st, st_pl, tag, lx, ly, h, span, bx, by, basement=idx == 0, ground=idx == 1,
                        furnished=idx in (1, 2), code=f"{b}{idx}")
        w.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{w.guid()}',$,$,$,{_ref(elems)},#{st})")
    roof_pl = m.placement(bld_pl, 0., 0., 4 * h)
    roof_st = w.add(f"IFCBUILDINGSTOREY('{w.guid()}',$,'Copertura',$,$,#{roof_pl},$,$,.ELEMENT.,{_f(4 * h)})")
    storeys.append(roof_st)
    w.add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{w.guid()}',$,$,$,{_ref(_roof(m, roof_pl, lx, ly))},#{roof_st})")
    w.add(f"IFCRELAGGREGATES('{w.guid()}',$,$,$,#{bld},{_ref(storeys)})")
    return bld


def _element(m: _Model, entity: str, name: str, parent_pl: int, pos: tuple[float, float, float], solids_fn,
             *, extra: str = "", tag: str = "$", angle: float = 0., style: int | None = None,
             predefined: str = "$") -> tuple[int, int]:
    """Elemento con posizione relativa a parent_pl; solids_fn() crea i solidi nel sistema dell'elemento."""
    w = m.w
    pl = m.placement(parent_pl, *pos, angle=angle)
    shape = m.shape(solids_fn(), style)
    tail = f"{tag},{extra}" if extra else f"{tag},{predefined}"
    if entity == "IFCFURNISHINGELEMENT":
        tail = tag
    e = w.add(f"{entity}('{w.guid()}',$,{_txt(name)},$,$,#{pl},#{shape},{tail})")
    return e, pl


def _wall(m: _Model, st_pl: int, name: str, x, y, dx, dy, height, *, external: bool, code: str,
          openings: list[tuple[float, float, float, float, str]] = (), fire: str = "REI 120",
          material: str = "Laterizio portante") -> list[int]:
    """Muro allineato agli assi; openings: (posizione lungo il muro, quota davanzale, larghezza, altezza, tipo)."""
    w = m.w
    wall, wpl = _element(m, "IFCWALL", name, st_pl, (x, y, 0.), lambda: [m.box_solid(dx, dy, height)],
                         tag=_txt(code), predefined=".STANDARD.")
    m.material(material, wall)
    thick, length = min(dx, dy), max(dx, dy)
    along_x = dx >= dy
    m.pset("Pset_WallCommon", [wall], [("IsExternal", _bool(external)), ("LoadBearing", _bool(external)),
                                        ("FireRating", _label(fire))]
           + ([("ThermalTransmittance", f"IFCTHERMALTRANSMITTANCEMEASURE({_f(0.22)})")] if external else []))
    m.pset("Qto_WallBaseQuantities", [wall], [("Length", _ql(length)), ("Width", _ql(thick)),
                                               ("Height", _ql(height)), ("GrossVolume", _qv(length * thick * height))])
    m.pset("CDE_Elemento", [wall], [("CodiceElemento", _label(code)), ("Fase", _label("Progetto esecutivo")),
                                     ("Responsabile", _label("DES"))])
    out = [wall]
    for k, (at, sill, ow, oh, kind) in enumerate(openings):
        if along_x:
            o_pos, o_dim = (at, -0.1, sill), (ow, thick + 0.2, oh)
            f_pos, f_dim = (at, thick / 2 - 0.03, sill), (ow, 0.06, oh)
        else:
            o_pos, o_dim = (-0.1, at, sill), (thick + 0.2, ow, oh)
            f_pos, f_dim = (thick / 2 - 0.03, at, sill), (0.06, ow, oh)
        op, _ = _element(m, "IFCOPENINGELEMENT", f"Apertura {k + 1} {name}", wpl, o_pos,
                         lambda o_dim=o_dim: [m.box_solid(*o_dim)], predefined=".OPENING.")
        w.add(f"IFCRELVOIDSELEMENT('{w.guid()}',$,$,$,#{wall},#{op})")
        if kind == "window":
            fill, _ = _element(m, "IFCWINDOW", f"Finestra {k + 1} {name}", wpl, f_pos,
                               lambda f_dim=f_dim: [m.box_solid(*f_dim)], style=m.glass,
                               tag=_txt(f"{code}-F{k + 1}"), extra=f"{_f(oh)},{_f(ow)},.WINDOW.,.SINGLE_PANEL.,$")
            m.material("Vetrocamera basso emissivo", fill)
            m.pset("Pset_WindowCommon", [fill], [("IsExternal", _bool(True)),
                                                 ("ThermalTransmittance", f"IFCTHERMALTRANSMITTANCEMEASURE({_f(1.1)})")])
        else:
            fill, _ = _element(m, "IFCDOOR", f"Porta {k + 1} {name}", wpl, f_pos,
                               lambda f_dim=f_dim: [m.box_solid(*f_dim)],
                               tag=_txt(f"{code}-P{k + 1}"), extra=f"{_f(oh)},{_f(ow)},.DOOR.,.SINGLE_SWING_LEFT.,$")
            m.material("Legno e acciaio", fill)
            m.pset("Pset_DoorCommon", [fill], [("IsExternal", _bool(external)), ("FireRating", _label("EI 30"))])
        w.add(f"IFCRELFILLSELEMENT('{w.guid()}',$,$,$,#{op},#{fill})")
        out.append(fill)
    return out


def _storey(m: _Model, st: int, st_pl: int, tag: str, lx, ly, h, span, bx, by, *, basement: bool, ground: bool,
            furnished: bool, code: str) -> list[int]:
    w = m.w
    elems: list[int] = []
    t, slab_t, beam_h = 0.3, 0.3, 0.5
    # solaio (sotto la quota del piano) o platea
    slab_name = "Platea di fondazione" if basement else f"Solaio {tag}"
    slab, _ = _element(m, "IFCSLAB", slab_name, st_pl, (0., 0., -slab_t), lambda: [m.box_solid(lx, ly, slab_t)],
                       tag=_txt(f"SOL-{tag}"), predefined=".BASESLAB." if basement else ".FLOOR.")
    m.material("Calcestruzzo C30/37", slab)
    m.pset("Pset_SlabCommon", [slab], [("LoadBearing", _bool(True)), ("FireRating", _label("REI 120"))])
    m.pset("Qto_SlabBaseQuantities", [slab], [("Width", _ql(slab_t)), ("GrossArea", _qa(lx * ly)),
                                               ("GrossVolume", _qv(lx * ly * slab_t))])
    elems.append(slab)
    # pilastri e travi
    col_h = h - slab_t
    cols = []
    for i in range(bx + 1):
        for j in range(by + 1):
            c, _ = _element(m, "IFCCOLUMN", f"Pilastro {chr(65 + j)}{i + 1} {tag}", st_pl,
                            (min(i * span, lx - 0.4), min(j * span, ly - 0.4), 0.), lambda: [m.box_solid(0.4, 0.4, col_h)],
                            tag=_txt(f"PIL-{chr(65 + j)}{i + 1}-{tag}"), predefined=".COLUMN.")
            cols.append(c)
    m.pset("Pset_ColumnCommon", cols, [("LoadBearing", _bool(True)), ("FireRating", _label("R 120"))])
    m.pset("Qto_ColumnBaseQuantities", cols, [("Length", _ql(col_h)), ("CrossSectionArea", _qa(0.16)),
                                              ("GrossVolume", _qv(0.16 * col_h))])
    beams = []
    for j in range(by + 1):
        for i in range(bx):
            bm, _ = _element(m, "IFCBEAM", f"Trave X{chr(65 + j)}{i + 1} {tag}", st_pl,
                             (i * span, min(j * span, ly - 0.3), h - slab_t - beam_h),
                             lambda: [m.box_solid(span, 0.3, beam_h)], predefined=".BEAM.")
            beams.append(bm)
    for i in range(bx + 1):
        for j in range(by):
            bm, _ = _element(m, "IFCBEAM", f"Trave Y{i + 1}{chr(65 + j)} {tag}", st_pl,
                             (min(i * span, lx - 0.3), j * span, h - slab_t - beam_h),
                             lambda: [m.box_solid(0.3, span, beam_h)], predefined=".BEAM.")
            beams.append(bm)
    m.pset("Pset_BeamCommon", beams, [("LoadBearing", _bool(True)), ("FireRating", _label("R 120"))])
    m.pset("Qto_BeamBaseQuantities", beams, [("Length", _ql(span)), ("CrossSectionArea", _qa(0.15))])
    for e in cols + beams:
        m.material("Calcestruzzo C30/37", e)
    elems += cols + beams
    # muri perimetrali: finestre per campata (niente nell'interrato), porta d'ingresso al piano terra
    wall_h = h - slab_t

    def windows(n_bays: int, door_bay: int | None = None):
        if basement:
            return []
        out = []
        for k in range(n_bays):
            if k == door_bay:
                out.append((k * span + span / 2 - 1.2, 0., 2.4, 2.7, "door"))
            else:
                out.append((k * span + span / 2 - 0.9, 0.9, 1.8, 1.5, "window"))
        return out

    ext_mat = "Calcestruzzo controterra" if basement else "Laterizio portante"
    elems += _wall(m, st_pl, f"Muro perimetrale sud {tag}", 0., 0., lx, t, wall_h, external=True, code=f"MUR-S-{tag}",
                   openings=windows(bx, door_bay=bx // 2 if ground else None), material=ext_mat)
    elems += _wall(m, st_pl, f"Muro perimetrale nord {tag}", 0., ly - t, lx, t, wall_h, external=True,
                   code=f"MUR-N-{tag}", openings=windows(bx), material=ext_mat)
    elems += _wall(m, st_pl, f"Muro perimetrale ovest {tag}", 0., t, t, ly - 2 * t, wall_h, external=True,
                   code=f"MUR-O-{tag}", openings=[(o[0] - t, *o[1:]) for o in windows(by)], material=ext_mat)
    elems += _wall(m, st_pl, f"Muro perimetrale est {tag}", lx - t, t, t, ly - 2 * t, wall_h, external=True,
                   code=f"MUR-E-{tag}", openings=[(o[0] - t, *o[1:]) for o in windows(by)], material=ext_mat)
    # corridoio centrale con una porta per campata, tramezzi tra le stanze
    yc1, yc2, tp = ly / 2 - 1.5, ly / 2 + 1.5, 0.15
    doors = [(k * span + 1.0, 0., 0.9, 2.1, "door") for k in range(bx)]
    elems += _wall(m, st_pl, f"Parete corridoio sud {tag}", t, yc1 - tp, lx - 2 * t, tp, wall_h, external=False,
                   code=f"PAR-CS-{tag}", openings=doors, fire="EI 60", material="Cartongesso su orditura metallica")
    elems += _wall(m, st_pl, f"Parete corridoio nord {tag}", t, yc2, lx - 2 * t, tp, wall_h, external=False,
                   code=f"PAR-CN-{tag}", openings=doors, fire="EI 60", material="Cartongesso su orditura metallica")
    for k in range(1, bx):
        name = "Tramezzo interno" if k == bx // 2 else f"Tramezzo {k}"
        elems += _wall(m, st_pl, f"{name} {tag}", k * span - tp / 2, t, tp, yc1 - tp - t, wall_h, external=False,
                       code=f"TRA-{k}S-{tag}", fire="EI 30", material="Cartongesso su orditura metallica")
        elems += _wall(m, st_pl, f"{name} nord {tag}", k * span - tp / 2, yc2 + tp, tp, ly - t - yc2 - tp, wall_h,
                       external=False, code=f"TRA-{k}N-{tag}", fire="EI 30", material="Cartongesso su orditura metallica")
    # scala nella prima campata ovest, lato sud: 20 alzate per salire di un piano, con ringhiera
    if not tag == "P3":
        steps = 20
        riser, tread, width = h / steps, 0.3, 1.4
        stair, _ = _element(m, "IFCSTAIR", f"Scala S1 {tag}", st_pl, (0.8, 0.6, 0.),
                            lambda: [m.box_solid(tread, width, riser * (k + 1), k * tread, 0., 0.) for k in range(steps)],
                            tag=_txt(f"SCA-S1-{tag}"), predefined=".STRAIGHT_RUN_STAIR.")
        m.material("Calcestruzzo C30/37", stair)
        m.pset("Pset_StairCommon", [stair], [("NumberOfRiser", f"IFCCOUNTMEASURE({steps})"),
                                             ("RiserHeight", f"IFCPOSITIVELENGTHMEASURE({_f(riser)})"),
                                             ("TreadLength", f"IFCPOSITIVELENGTHMEASURE({_f(tread)})")])
        rail, _ = _element(m, "IFCRAILING", f"Ringhiera scala S1 {tag}", st_pl, (0.8, 0.6 + width, 0.),
                           lambda: [m.box_solid(tread, 0.05, riser * (k + 1) + 1.0, k * tread, 0., 0.)
                                    for k in range(0, steps, 4)],
                           predefined=".HANDRAIL.")
        m.material("Acciaio S355", rail)
        elems += [stair, rail]
    # ambienti (senza geometria: compaiono nell'albero) e arredi
    spaces = []
    for side, y0 in (("S", t), ("N", yc2 + tp)):
        for k in range(bx):
            room = ROOMS[(k + (0 if side == "S" else 5) + len(tag)) % len(ROOMS)]
            sp_pl = m.placement(st_pl, k * span, y0, 0.)
            spaces.append(w.add(f"IFCSPACE('{w.guid()}',$,{_txt(f'{code}.{side}{k + 1:02d}')},$,$,#{sp_pl},$,"
                                f"{_txt(f'{room} {k + 1}')},.ELEMENT.,.INTERNAL.,$)"))
            if furnished and room in ("Ambulatorio", "Studio medico", "Ufficio"):
                for d in range(2):
                    desk, _ = _element(m, "IFCFURNISHINGELEMENT", f"Scrivania {d + 1} {room} {k + 1} {tag}", st_pl,
                                       (k * span + 1.0 + d * 2.4, y0 + 1.2, 0.), lambda: [m.box_solid(1.6, 0.8, 0.75)],
                                       tag=_txt(f"ARR-{side}{k + 1}-{d + 1}-{tag}"))
                    m.material("Laminato e acciaio", desk)
                    elems.append(desk)
    corr_pl = m.placement(st_pl, t, yc1, 0.)
    spaces.append(w.add(f"IFCSPACE('{w.guid()}',$,{_txt(f'{code}.C')},$,$,#{corr_pl},$,'Corridoio',.ELEMENT.,.INTERNAL.,$)"))
    w.add(f"IFCRELAGGREGATES('{w.guid()}',$,$,$,#{st},{_ref(spaces)})")
    # pensilina d'ingresso ruotata di 15° con due pilastri (piano terra)
    if ground:
        ang = math.radians(15)
        can, _ = _element(m, "IFCSLAB", "Pensilina ingresso", st_pl, (lx / 2 - 4., -5.5, 3.2),
                          lambda: [m.box_solid(8., 4.5, 0.25)], angle=ang, tag=_txt("PEN-01"), predefined=".ROOF.")
        m.material("Acciaio S355", can)
        elems.append(can)
        for k, dxp in enumerate((0.5, 7.)):
            cx = lx / 2 - 4. + dxp * math.cos(ang)
            cy = -5.5 + dxp * math.sin(ang) + 0.5
            c, _ = _element(m, "IFCCOLUMN", f"Pilastro pensilina {k + 1}", st_pl, (cx, cy, 0.),
                            lambda: [m.box_solid(0.25, 0.25, 3.2)], angle=ang, predefined=".COLUMN.")
            m.material("Acciaio S355", c)
            elems.append(c)
    return elems


def _roof(m: _Model, pl: int, lx: float, ly: float) -> list[int]:
    elems = []
    roof, _ = _element(m, "IFCROOF", "Solaio di copertura", pl, (0., 0., -0.3), lambda: [m.box_solid(lx, ly, 0.3)],
                       tag=_txt("COP-01"), predefined=".FLAT_ROOF.")
    m.material("Calcestruzzo C30/37", roof)
    m.pset("Pset_RoofCommon", [roof], [("IsExternal", _bool(True)), ("FireRating", _label("REI 120"))])
    m.pset("Qto_RoofBaseQuantities", [roof], [("GrossArea", _qa(lx * ly))])
    elems.append(roof)
    for name, x, y, dx, dy in (("sud", 0., 0., lx, 0.2), ("nord", 0., ly - 0.2, lx, 0.2),
                               ("ovest", 0., 0.2, 0.2, ly - 0.4), ("est", lx - 0.2, 0.2, 0.2, ly - 0.4)):
        elems += _wall(m, pl, f"Parapetto {name}", x, y, dx, dy, 1.1, external=True, code=f"PAR-{name[0].upper()}-RF",
                       fire="REI 60", material="Calcestruzzo C30/37")
    # locale tecnico in copertura
    tx, ty, tw, td, th = lx - 10., ly / 2 - 3., 8., 6., 3.
    for name, x, y, dx, dy in (("sud", tx, ty, tw, 0.25), ("nord", tx, ty + td - 0.25, tw, 0.25),
                               ("ovest", tx, ty + 0.25, 0.25, td - 0.5), ("est", tx + tw - 0.25, ty + 0.25, 0.25, td - 0.5)):
        doors = [(1.0, 0., 1.2, 2.2, "door")] if name == "ovest" else []
        elems += _wall(m, pl, f"Muro locale tecnico {name}", x, y, dx, dy, th, external=True,
                       code=f"LT-{name[0].upper()}", openings=doors, fire="REI 60", material="Calcestruzzo C30/37")
    lt_roof, _ = _element(m, "IFCSLAB", "Copertura locale tecnico", pl, (tx, ty, th), lambda: [m.box_solid(tw, td, 0.2)],
                          predefined=".ROOF.")
    m.material("Calcestruzzo C30/37", lt_roof)
    elems.append(lt_roof)
    return elems
