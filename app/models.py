"""
Modello dati per il sistema tipo "Field View".

Concetti chiave:
- Project: un cantiere/progetto
- Plan: una planimetria (immagine/PDF) caricata per il progetto
- Pin: un punto sulla planimetria (coordinate x/y relative 0-1, così funzionano
  a qualunque risoluzione l'immagine venga renderizzata)
- FormTemplate: definizione di un modulo dinamico (lo schema JSON dei campi)
- WbsNode: una voce dell'albero WBS (Work Breakdown Structure) del cantiere
- FormSubmission: un'istanza compilata di un FormTemplate, agganciata a un Pin
  oppure a una voce WBS (esattamente uno dei due)
- Task: un'azione da seguire (es. "risolvi questo difetto"), con stato e assegnatario
- Attachment: foto/file collegati a una submission o a un task

Entità sincronizzabili (Pin, FormSubmission, Task, Attachment):
- `id` è un UUID v4 generato DAL CLIENT quando l'entità nasce offline (o dal
  server se nasce da web). Non esiste un id server separato: così una submission
  creata offline può referenziare un pin creato offline nello stesso batch.
- `updated_at` serve per il pull incrementale e per il "last write wins".
- `deleted_at` è il soft-delete: le cancellazioni devono viaggiare nel sync
  come qualsiasi altra modifica, altrimenti gli altri device non le vedono mai.
"""
import uuid
import enum
from datetime import datetime, timezone

from sqlalchemy import (
    Column, String, Text, Float, Boolean, ForeignKey, DateTime, Enum, JSON, Index, Integer, MetaData, true
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship

# Nomi deterministici per indici/vincoli: servono ad Alembic per generare
# ALTER TABLE (soprattutto in batch mode su SQLite, dove i vincoli anonimi
# non si possono modificare).
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
Base = declarative_base(metadata=MetaData(naming_convention=NAMING_CONVENTION))

# JSON generico su SQLite, JSONB su Postgres (indicizzabile, query sui campi).
JSONType = JSON().with_variant(JSONB(), "postgresql")


def sa_true():
    from sqlalchemy import true
    return true()


def gen_uuid():
    return str(uuid.uuid4())


def utcnow():
    """UTC naive: SQLite non conserva il tz, quindi teniamo tutto naive-UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class TaskStatus(str, enum.Enum):
    open = "open"
    assigned = "assigned"
    resolved = "resolved"
    verified = "verified"


# Transizioni ammesse via PATCH /tasks (web). Il sync offline NON le applica:
# un device può aver fatto open->assigned->resolved senza rete e pushare solo
# lo stato finale, quindi lì vale il last-write-wins sul valore.
TASK_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.open: {TaskStatus.assigned},
    TaskStatus.assigned: {TaskStatus.resolved, TaskStatus.open},
    TaskStatus.resolved: {TaskStatus.verified, TaskStatus.open},   # open = riaperto
    TaskStatus.verified: set(),
}


class UserRole(str, enum.Enum):
    admin = "admin"      # tutto, tutti i progetti
    manager = "manager"  # ufficio: crea progetti/planimetrie/template, verifica task
    field = "field"      # cantiere: pin, moduli, task nei progetti di cui è membro


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=gen_uuid)
    email = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(UserRole), default=UserRole.field, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    # Preferenze di notifica minime (giorno 26): canali attivi.
    notify_email = Column(Boolean, default=True, nullable=False)
    notify_push = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class ProjectMember(Base):
    """Chi vede/opera su un progetto. Gli admin non hanno bisogno di righe qui."""
    __tablename__ = "project_members"

    project_id = Column(String, ForeignKey("projects.id"), primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), primary_key=True, index=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)


class SyncMixin:
    """Colonne comuni a tutte le entità che viaggiano nel sync."""
    id = Column(String, primary_key=True, default=gen_uuid)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class CommessaParam(Base):
    """
    Parametro personalizzato a scelta multipla definito dall'admin (es. "Tipologia
    lavori": Edilizia / Stradale / Impianti). Ogni commessa ne valorizza zero o più
    opzioni in `Commessa.params` ({param_id: [opzione, ...]}).
    """
    __tablename__ = "commessa_params"

    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    options = Column(JSONType, nullable=False, default=list)   # lista di stringhe, ordine = ordine di visualizzazione
    multi = Column(Boolean, default=True, nullable=False, server_default=true())  # False = una sola opzione
    position = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class Commessa(Base):
    """
    Commessa (appalto/contratto): raggruppa i cantieri (Project). Selezionata
    dalla barra in alto del web; i cantieri associati sono il suo sottomenù.
    """
    __tablename__ = "commesse"

    id = Column(String, primary_key=True, default=gen_uuid)
    code = Column(String, nullable=False, unique=True, index=True)   # es. C-2026-014
    name = Column(String, nullable=False)
    client = Column(String, nullable=True)                           # committente / ente appaltante
    params = Column(JSONType, nullable=False, default=dict)          # {param_id: [opzione, ...]}
    archived_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    projects = relationship("Project", back_populates="commessa", order_by="Project.name")


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    address = Column(String, nullable=True)
    commessa_id = Column(String, ForeignKey("commesse.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=utcnow)

    plans = relationship("Plan", back_populates="project")
    commessa = relationship("Commessa", back_populates="projects")
    wbs_nodes = relationship("WbsNode", back_populates="project")


class WbsNode(Base):
    """
    Voce dell'albero WBS di un cantiere (es. "01 Opere strutturali" > "01.02 Solai").
    Ogni cantiere ha il suo albero; selezionando una voce sul web si compilano
    i moduli agganciati a quella voce (FormSubmission.wbs_node_id). Solo web,
    non viaggia nel sync: le submission su WBS sono escluse dal pull dell'app.
    """
    __tablename__ = "wbs_nodes"

    id = Column(String, primary_key=True, default=gen_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    parent_id = Column(String, ForeignKey("wbs_nodes.id"), nullable=True, index=True)
    code = Column(String, nullable=True)       # es. "01.02"
    name = Column(String, nullable=False)
    position = Column(Integer, default=0, nullable=False)   # ordine tra fratelli
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    project = relationship("Project", back_populates="wbs_nodes")
    parent = relationship("WbsNode", remote_side=[id], back_populates="children")
    children = relationship("WbsNode", back_populates="parent", order_by="WbsNode.position")
    submissions = relationship("FormSubmission", back_populates="wbs_node")


class Plan(Base):
    """Una planimetria (immagine o PDF renderizzato a immagine) di un progetto."""
    __tablename__ = "plans"

    id = Column(String, primary_key=True, default=gen_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String, nullable=False)          # es. "Piano terra"
    # Valorizzati da POST /plans/{id}/file. Nulli finché il file non è caricato.
    file_url = Column(String, nullable=True)        # url nello storage (S3-like)
    width_px = Column(Float, nullable=True)
    height_px = Column(Float, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)

    project = relationship("Project", back_populates="plans")
    pins = relationship("Pin", back_populates="plan")


class Pin(SyncMixin, Base):
    """
    Un punto sulla planimetria. x/y sono RELATIVI (0.0-1.0), non pixel assoluti,
    così il pin resta nella posizione corretta indipendentemente dallo zoom
    o dalla risoluzione con cui il client renderizza l'immagine.
    """
    __tablename__ = "pins"

    plan_id = Column(String, ForeignKey("plans.id"), nullable=False, index=True)
    x = Column(Float, nullable=False)  # 0.0 - 1.0
    y = Column(Float, nullable=False)  # 0.0 - 1.0
    label = Column(String, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)

    plan = relationship("Plan", back_populates="pins")
    submissions = relationship("FormSubmission", back_populates="pin")
    tasks = relationship("Task", back_populates="pin")


class FormTemplate(Base):
    """
    Definizione di un modulo dinamico. 'schema' è un JSON che descrive i campi.
    Vedi form_schema_example.json per il formato.
    """
    __tablename__ = "form_templates"

    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)         # es. "Ispezione sicurezza"
    category = Column(String, nullable=True)       # es. "safety", "quality"
    schema_def = Column(JSONType, nullable=False)     # definizione campi
    # Archiviato = non proponibile per nuove compilazioni; resta leggibile per
    # le submission esistenti e viaggia nel sync come gli altri.
    archived_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class FormSubmission(SyncMixin, Base):
    """Un'istanza compilata di un FormTemplate, agganciata a un pin o a una voce WBS (uno dei due)."""
    __tablename__ = "form_submissions"

    template_id = Column(String, ForeignKey("form_templates.id"), nullable=False)
    pin_id = Column(String, ForeignKey("pins.id"), nullable=True, index=True)
    wbs_node_id = Column(String, ForeignKey("wbs_nodes.id"), nullable=True, index=True)
    data_json = Column(JSONType, nullable=False)       # risposte, chiave = field id
    submitted_by = Column(String, ForeignKey("users.id"), nullable=True)

    pin = relationship("Pin", back_populates="submissions")
    wbs_node = relationship("WbsNode", back_populates="submissions")
    attachments = relationship("Attachment", back_populates="submission")


class Task(SyncMixin, Base):
    __tablename__ = "tasks"

    pin_id = Column(String, ForeignKey("pins.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(Enum(TaskStatus), default=TaskStatus.open, nullable=False)
    assigned_to = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=True)
    due_date = Column(DateTime, nullable=True)
    # Primo passaggio a resolved (serie "risolti al giorno" della dashboard); azzerato se riaperto.
    resolved_at = Column(DateTime, nullable=True, index=True)

    pin = relationship("Pin", back_populates="tasks")
    attachments = relationship("Attachment", back_populates="task")


class Attachment(SyncMixin, Base):
    __tablename__ = "attachments"

    submission_id = Column(String, ForeignKey("form_submissions.id"), nullable=True, index=True)
    task_id = Column(String, ForeignKey("tasks.id"), nullable=True, index=True)
    # Nullo finché il file non è stato caricato (l'app crea prima il record
    # nel sync, poi manda i byte a POST /attachments/{id}/upload).
    file_url = Column(String, nullable=True)
    file_type = Column(String, nullable=True)  # "photo", "signature", "doc"

    submission = relationship("FormSubmission", back_populates="attachments")
    task = relationship("Task", back_populates="attachments")


Index("ix_pins_updated_at", Pin.updated_at)
Index("ix_form_submissions_updated_at", FormSubmission.updated_at)
Index("ix_tasks_updated_at", Task.updated_at)
Index("ix_attachments_updated_at", Attachment.updated_at)


class Event(Base):
    """
    Outbox degli eventi di dominio, scritta nella stessa transazione della
    modifica (anche dal sync push): il worker delle notifiche (giorno 27) la
    consuma. Tipi: submission.created, task.created, task.status_changed, task.assigned.
    """
    __tablename__ = "events"

    id = Column(String, primary_key=True, default=gen_uuid)
    type = Column(String, nullable=False, index=True)
    entity_type = Column(String, nullable=False)   # submission | task
    entity_id = Column(String, nullable=False, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    actor_id = Column(String, ForeignKey("users.id"), nullable=True)
    payload = Column(JSONType, nullable=False, default=dict)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)
    processed_at = Column(DateTime, nullable=True)

    notifications = relationship("Notification", back_populates="event")


class AuditLog(Base):
    """
    Registro operazioni (spazio admin): una riga per azione rilevante, scritta
    nella transazione dell'endpoint. `actor_email` è denormalizzata così i login
    falliti e gli utenti disattivati restano leggibili. Mai consumata né cancellata.
    """
    __tablename__ = "audit_log"

    id = Column(String, primary_key=True, default=gen_uuid)
    action = Column(String, nullable=False, index=True)
    actor_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    actor_email = Column(String, nullable=True)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True, index=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=True, index=True)
    details = Column(JSONType, nullable=False, default=dict)
    ip = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False, index=True)

    actor = relationship("User")


class Notification(Base):
    """Una consegna da fare: evento × destinatario × canale. Il worker la porta a sent/failed."""
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, default=gen_uuid)
    event_id = Column(String, ForeignKey("events.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    channel = Column(String, nullable=False)      # email | push
    status = Column(String, nullable=False, default="pending", index=True)  # pending | sent | failed
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    sent_at = Column(DateTime, nullable=True)

    event = relationship("Event", back_populates="notifications")
    user = relationship("User")


class PushToken(Base):
    """Token Expo Push di un device; registrato dall'app al login, rimosso al logout o se Expo lo segnala invalido."""
    __tablename__ = "push_tokens"

    token = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    platform = Column(String, nullable=True)  # ios | android
    created_at = Column(DateTime, default=utcnow, nullable=False)
    last_seen_at = Column(DateTime, default=utcnow, nullable=False)
