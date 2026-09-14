"""
Modello dati per il sistema tipo "Field View".

Concetti chiave:
- Project: un cantiere/progetto
- Plan: una planimetria (immagine/PDF) caricata per il progetto
- Pin: un punto sulla planimetria (coordinate x/y relative 0-1, così funzionano
  a qualunque risoluzione l'immagine venga renderizzata)
- FormTemplate: definizione di un modulo dinamico (lo schema JSON dei campi)
- FormSubmission: un'istanza compilata di un FormTemplate, agganciata a un Pin
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
    Column, String, Text, Float, ForeignKey, DateTime, Enum, JSON, Index
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


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


class SyncMixin:
    """Colonne comuni a tutte le entità che viaggiano nel sync."""
    id = Column(String, primary_key=True, default=gen_uuid)
    created_at = Column(DateTime, default=utcnow, nullable=False)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    deleted_at = Column(DateTime, nullable=True)


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True, default=gen_uuid)
    name = Column(String, nullable=False)
    address = Column(String, nullable=True)
    created_at = Column(DateTime, default=utcnow)

    plans = relationship("Plan", back_populates="project")


class Plan(Base):
    """Una planimetria (immagine o PDF renderizzato a immagine) di un progetto."""
    __tablename__ = "plans"

    id = Column(String, primary_key=True, default=gen_uuid)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    name = Column(String, nullable=False)          # es. "Piano terra"
    file_url = Column(String, nullable=False)       # url nello storage (S3-like)
    width_px = Column(Float, nullable=False)
    height_px = Column(Float, nullable=False)
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
    created_by = Column(String, nullable=True)  # user id

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
    schema_json = Column(JSON, nullable=False)     # definizione campi
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


class FormSubmission(SyncMixin, Base):
    """Un'istanza compilata di un FormTemplate, agganciata a un pin."""
    __tablename__ = "form_submissions"

    template_id = Column(String, ForeignKey("form_templates.id"), nullable=False)
    pin_id = Column(String, ForeignKey("pins.id"), nullable=False, index=True)
    data_json = Column(JSON, nullable=False)       # risposte, chiave = field id
    submitted_by = Column(String, nullable=True)

    pin = relationship("Pin", back_populates="submissions")
    attachments = relationship("Attachment", back_populates="submission")


class Task(SyncMixin, Base):
    __tablename__ = "tasks"

    pin_id = Column(String, ForeignKey("pins.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(Enum(TaskStatus), default=TaskStatus.open, nullable=False)
    assigned_to = Column(String, nullable=True)
    due_date = Column(DateTime, nullable=True)

    pin = relationship("Pin", back_populates="tasks")
    attachments = relationship("Attachment", back_populates="task")


class Attachment(SyncMixin, Base):
    __tablename__ = "attachments"

    submission_id = Column(String, ForeignKey("form_submissions.id"), nullable=True, index=True)
    task_id = Column(String, ForeignKey("tasks.id"), nullable=True, index=True)
    file_url = Column(String, nullable=False)
    file_type = Column(String, nullable=True)  # "photo", "signature", "doc"

    submission = relationship("FormSubmission", back_populates="attachments")
    task = relationship("Task", back_populates="attachments")


Index("ix_pins_updated_at", Pin.updated_at)
Index("ix_form_submissions_updated_at", FormSubmission.updated_at)
Index("ix_tasks_updated_at", Task.updated_at)
Index("ix_attachments_updated_at", Attachment.updated_at)
