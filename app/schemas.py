from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class UserUpdate(BaseModel):
    """PATCH /users/{id} (solo admin): tutti opzionali; `password` reimposta la password."""
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=8)


# ---------- Inviti ed etichette (credenziali preimpostate) ----------

class InviteLabelCreate(BaseModel):
    """Etichetta = profilo preimpostato. Solo admin (vedi app/invites.py)."""
    name: str
    description: Optional[str] = None
    role: str = "field"
    project_ids: list[str] = Field(default_factory=list)
    commessa_ids: list[str] = Field(default_factory=list)
    notify_email: bool = True
    notify_push: bool = True


class InviteLabelUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    role: Optional[str] = None
    project_ids: Optional[list[str]] = None
    commessa_ids: Optional[list[str]] = None
    notify_email: Optional[bool] = None
    notify_push: Optional[bool] = None
    position: Optional[int] = None
    archived: Optional[bool] = None


class InviteLabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    name: str
    description: Optional[str] = None
    role: str
    project_ids: list[str] = Field(default_factory=list)
    commessa_ids: list[str] = Field(default_factory=list)
    notify_email: bool = True
    notify_push: bool = True
    position: int = 0
    archived_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    # calcolati: cantieri effettivi (commesse espanse) e inviti che la usano
    projects_count: int = 0
    pending_invites: int = 0


class InviteCreate(BaseModel):
    email: str
    label_id: str
    name: Optional[str] = None


class InviteOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: Optional[str] = None
    label_id: str
    label_name: str
    role: str
    status: str                      # pending | accepted | revoked | expired
    invited_by_id: Optional[str] = None
    invited_by_name: Optional[str] = None
    expires_at: datetime
    accepted_at: Optional[datetime] = None
    revoked_at: Optional[datetime] = None
    email_sent_at: Optional[datetime] = None
    created_at: datetime
    # solo nella risposta di creazione/reinvio: il link esiste in chiaro una volta sola
    url: Optional[str] = None


class InvitePreviewOut(BaseModel):
    """Vista pubblica del link d'invito (nessun token in uscita)."""
    email: str
    name: Optional[str] = None
    label_name: str
    role: str
    projects_count: int
    expires_at: datetime


class InviteAccept(BaseModel):
    token: str
    name: str
    password: str = Field(min_length=8)


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    action: str
    actor_id: Optional[str] = None
    actor_email: Optional[str] = None
    actor_name: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    details: dict
    ip: Optional[str] = None
    user_agent: Optional[str] = None
    created_at: datetime


class AuditPage(BaseModel):
    items: list[AuditOut]
    total: int
    limit: int
    offset: int


class AuditActionOut(BaseModel):
    action: str
    label: str


class UserActivityOut(BaseModel):
    """Riepilogo per utente nello spazio admin: ultimo accesso e numero di operazioni."""
    user_id: str
    last_login: Optional[datetime] = None
    actions_total: int = 0
    actions_last_30d: int = 0


class PushTokenIn(BaseModel):
    token: str = Field(min_length=10)
    platform: Optional[str] = None


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
    commessa_id: Optional[str] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    commessa_id: Optional[str] = None   # "" o null = nessuna commessa


class ProjectOut(ProjectCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    created_at: datetime


# ---------- Commesse e parametri personalizzati ----------

class CommessaParamCreate(BaseModel):
    """Parametro a scelta multipla definito dall'admin: nome + opzioni (stringhe non vuote, senza doppioni)."""
    name: str = Field(min_length=1)
    options: list[str] = Field(min_length=1)
    multi: bool = True


class CommessaParamUpdate(BaseModel):
    name: Optional[str] = None
    options: Optional[list[str]] = None
    multi: Optional[bool] = None
    position: Optional[int] = None


class CommessaParamOut(CommessaParamCreate):
    model_config = ConfigDict(from_attributes=True)
    id: str
    position: int
    used_by: int = 0   # quante commesse hanno almeno un valore


class CommessaCreate(BaseModel):
    code: str = Field(min_length=1)
    name: str = Field(min_length=1)
    client: Optional[str] = None
    params: dict[str, list[str]] = {}   # {param_id: [opzione, ...]}, validato contro i parametri definiti


class CommessaUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    client: Optional[str] = None
    params: Optional[dict[str, list[str]]] = None
    archived: Optional[bool] = None


class CommessaOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    code: str
    name: str
    client: Optional[str] = None
    params: dict[str, list[str]] = {}
    archived_at: Optional[datetime] = None
    created_at: datetime
    projects: list[ProjectOut] = []   # solo i cantieri accessibili all'utente


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
    """Compilazione di un modulo su un pin oppure su una voce WBS: esattamente uno dei due."""
    template_id: str
    pin_id: Optional[str] = None
    wbs_node_id: Optional[str] = None
    data_json: dict
    submitted_by: Optional[str] = None

    @model_validator(mode="after")
    def _one_parent(self):
        if bool(self.pin_id) == bool(self.wbs_node_id):
            raise ValueError("exactly one of pin_id or wbs_node_id is required")
        return self


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
    resolved_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    attachments: list[AttachmentOut] = []


class StatsSeriesPoint(BaseModel):
    date: str
    created: int
    resolved: int


class StatsOut(BaseModel):
    project_id: str
    generated_at: datetime
    tasks_by_status: dict[str, int]
    tasks_total: int
    open_by_plan: list[dict]
    submissions_by_template: list[dict]
    submissions_total: int
    series: list[StatsSeriesPoint]
    overdue: int
    closed_last_7d: int
    pins_total: int


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


# ---------- WBS ----------

class WbsNodeCreate(BaseModel):
    name: str = Field(min_length=1)
    code: Optional[str] = None
    parent_id: Optional[str] = None

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("code", mode="before")
    @classmethod
    def _strip_code(cls, v):
        return (v.strip() or None) if isinstance(v, str) else v


class WbsNodeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    code: Optional[str] = None
    parent_id: Optional[str] = None
    position: Optional[int] = None

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("code", mode="before")
    @classmethod
    def _strip_code(cls, v):
        return (v.strip() or None) if isinstance(v, str) else v


class WbsNodeOut(BaseModel):
    """Voce dell'albero WBS (lista piatta: il client ricostruisce l'albero da parent_id)."""
    model_config = ConfigDict(from_attributes=True)
    id: str
    project_id: str
    parent_id: Optional[str] = None
    code: Optional[str] = None
    name: str
    position: int
    submissions_count: int = 0   # solo le proprie (non i discendenti)
    created_at: datetime
    updated_at: datetime


class WbsImportRow(BaseModel):
    row: int
    code: Optional[str] = None
    name: str
    parent_code: Optional[str] = None
    action: str            # create | update | error
    error: Optional[str] = None


class WbsImportResult(BaseModel):
    """Esito (o anteprima, se dry_run) dell'import da Excel/CSV: una riga per riga del file."""
    dry_run: bool
    rows: list[WbsImportRow]
    created: int
    updated: int
    errors: int


class WbsNodeDetail(WbsNodeOut):
    """Voce con i moduli compilati su di essa: è ciò che apre la vista WBS al click."""
    submissions: list[SubmissionOut] = []


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
