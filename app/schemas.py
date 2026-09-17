from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


def to_naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Normalizza qualsiasi datetime a UTC naive: il client può mandare
    "2026-09-14T10:00:00+02:00" o "…Z", il DB (SQLite) salva naive.
    Senza questa normalizzazione il confronto naive vs aware alza TypeError.
    """
    if dt is None or dt.tzinfo is None:
        return dt
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


# --- Auth / utenti ---

class LoginRequest(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    email: str
    name: str
    password: str = Field(min_length=8)
    role: str = "field"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: str
    role: str
    is_active: bool
    notify_email: bool = True
    notify_push: bool = True


class PreferencesUpdate(BaseModel):
    notify_email: Optional[bool] = None
    notify_push: Optional[bool] = None


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    type: str
    entity_type: str
    entity_id: str
    project_id: str
    actor_id: Optional[str] = None
    payload: dict
    created_at: datetime
    processed_at: Optional[datetime] = None


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    event_id: str
    channel: str
    status: str
    error: Optional[str] = None
    created_at: datetime
    sent_at: Optional[datetime] = None
    event: EventOut


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MemberAdd(BaseModel):
    user_id: str


class ProjectCreate(BaseModel):
    name: str
    address: Optional[str] = None


class ProjectOut(ProjectCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


class PlanCreate(BaseModel):
    project_id: str
    name: str
    # Opzionali: normalmente il file arriva dopo con POST /plans/{id}/file.
    file_url: Optional[str] = None
    width_px: Optional[float] = None
    height_px: Optional[float] = None


class PlanOut(PlanCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime


class FormTemplateCreate(BaseModel):
    name: str
    category: Optional[str] = None
    schema_def: dict


class FormTemplateUpdate(BaseModel):
    """PATCH parziale. `schema_def` è modificabile solo finché nessuna submission usa il template."""
    name: Optional[str] = None
    category: Optional[str] = None
    schema_def: Optional[dict] = None
    archived: Optional[bool] = None


class FormTemplateOut(FormTemplateCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    archived_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    submissions_count: int = 0


class AttachmentCreate(BaseModel):
    # Opzionale: UUID generato dal client, così data_json (campi photo/signature)
    # può referenziare l'allegato prima che esista sul server, come nel sync.
    id: Optional[str] = None
    submission_id: Optional[str] = None
    task_id: Optional[str] = None
    file_type: Optional[str] = None  # "photo", "signature", "doc"


class AttachmentOut(AttachmentCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str  # type: ignore[assignment]
    file_url: Optional[str] = None   # None = byte non ancora caricati
    created_at: datetime
    updated_at: datetime


class PresignRequest(BaseModel):
    attachment_id: str


class PresignResponse(BaseModel):
    """
    Dove e come caricare i byte di un allegato. Oggi punta all'upload diretto
    sull'API; con S3 diventerà un presigned PUT e `fields`/`headers` cambieranno.
    """
    attachment_id: str
    method: str
    upload_url: str
    max_bytes: int


class SubmissionCreate(BaseModel):
    template_id: str
    pin_id: str
    data_json: dict
    submitted_by: Optional[str] = None


class SubmissionUpdate(BaseModel):
    data_json: dict


class SubmissionOut(SubmissionCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentOut] = []


class TaskCreate(BaseModel):
    pin_id: str
    title: str
    description: Optional[str] = None
    assigned_to: Optional[str] = None   # se valorizzato il task nasce già "assigned"
    due_date: Optional[datetime] = None

    @field_validator("due_date", mode="after")
    @classmethod
    def _naive_due(cls, v):
        return to_naive_utc(v)


class TaskUpdate(BaseModel):
    """PATCH parziale: solo i campi presenti vengono modificati."""
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[datetime] = None

    @field_validator("due_date", mode="after")
    @classmethod
    def _naive_due(cls, v):
        return to_naive_utc(v)


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    pin_id: str
    title: str
    description: Optional[str] = None
    status: str
    assigned_to: Optional[str] = None
    created_by: Optional[str] = None
    due_date: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentOut] = []


class TaskListItem(TaskOut):
    """Task + dove sta: basta alla vista task di progetto per il link "vedi sulla planimetria"."""
    plan_id: str
    plan_name: str
    pin_label: Optional[str] = None


class PinCreate(BaseModel):
    plan_id: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    label: Optional[str] = None


class PinUpdate(BaseModel):
    x: Optional[float] = Field(None, ge=0.0, le=1.0)
    y: Optional[float] = Field(None, ge=0.0, le=1.0)
    label: Optional[str] = None


class PinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    plan_id: str
    x: float
    y: float
    label: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PinSummary(PinOut):
    """Pin + conteggi: basta alla plan view per colorare i marker senza caricare i dettagli."""
    submissions_count: int = 0
    tasks_open: int = 0
    tasks_assigned: int = 0
    tasks_resolved: int = 0
    tasks_verified: int = 0


class PinDetail(PinOut):
    """Pin con tutto ciò che gli è agganciato: è ciò che apre la plan view al click."""
    submissions: list[SubmissionOut] = []
    tasks: list[TaskOut] = []


# --- Modelli "sync" ---
# Payload che l'app nativa manda quando torna online.
# `id` è un UUID v4 generato sul device al momento della creazione (offline),
# così il server può fare upsert idempotente anche se il pacchetto arriva
# duplicato o in ritardo, e una submission/task creata offline può puntare
# a un pin creato offline nello stesso batch (stesso id ovunque).
# `deleted_at` valorizzato = il device ha cancellato l'entità.

class SyncBase(BaseModel):
    id: str
    updated_at: datetime
    deleted_at: Optional[datetime] = None

    @field_validator("updated_at", "deleted_at", mode="after")
    @classmethod
    def _naive(cls, v):
        return to_naive_utc(v)


class PinSync(SyncBase):
    plan_id: str
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    label: Optional[str] = None
    created_by: Optional[str] = None


class FormSubmissionSync(SyncBase):
    template_id: str
    pin_id: str
    data_json: dict
    submitted_by: Optional[str] = None


class TaskSync(SyncBase):
    pin_id: str
    title: str
    description: Optional[str] = None
    status: str = "open"
    assigned_to: Optional[str] = None
    created_by: Optional[str] = None
    due_date: Optional[datetime] = None

    @field_validator("due_date", mode="after")
    @classmethod
    def _naive_due(cls, v):
        return to_naive_utc(v)


class AttachmentSync(SyncBase):
    submission_id: Optional[str] = None
    task_id: Optional[str] = None
    file_url: Optional[str] = None   # il device lo lascia nullo, lo imposta l'upload
    file_type: Optional[str] = None


class SyncPushRequest(BaseModel):
    pins: list[PinSync] = []
    submissions: list[FormSubmissionSync] = []
    tasks: list[TaskSync] = []
    attachments: list[AttachmentSync] = []


class RejectedItem(BaseModel):
    id: str
    reason: str  # es. "pin_id not found", "data_json: esito: not one of options"


class SyncPushResult(BaseModel):
    inserted: int = 0
    updated: int = 0
    skipped: int = 0   # push più vecchio di quanto già sul server (last write wins)
    skipped_ids: list[str] = []  # quali: il device può segnalare all'utente la modifica persa
    rejected: list[RejectedItem] = []  # righe rifiutate singolarmente, con motivo


class SyncPushResponse(BaseModel):
    status: str = "ok"
    pins: SyncPushResult
    submissions: SyncPushResult
    tasks: SyncPushResult
    attachments: SyncPushResult
    server_time: datetime


class SyncPullResponse(BaseModel):
    """
    Tutto ciò che è cambiato dopo `since` per un dato progetto.
    Le righe con deleted_at valorizzato vanno rimosse localmente dal client.
    """
    plans: list[dict]
    form_templates: list[dict]
    pins: list[dict]
    submissions: list[dict]
    tasks: list[dict]
    attachments: list[dict]
    server_time: datetime
