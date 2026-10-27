# "><(((º> sabusabu <º)))><"
"""Dataset dimostrativo: un progetto condiviso da committente, progettista e due subappaltatori.

Usato da test automatici, demo di Sprint Review e ambiente di sviluppo. Scrive come cde_owner
(bypassa la RLS): non è un percorso applicativo.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

import psycopg
from argon2 import PasswordHasher

DEMO_PASSWORD = "Cantiere-2026!"  # noqa: S105 - solo dati demo/test

ORGS = {
    "COM": ("Committente Infrastrutture SpA", "APPOINTING_PARTY"),
    "DES": ("Studio Progettazione Srl", "APPOINTED_PARTY"),
    "GCO": ("General Contractor SpA", "LEAD_APPOINTED_PARTY"),
    "SUB1": ("Impianti Elettrici Srl", "SUBCONTRACTOR"),
    "SUB2": ("Carpenterie Metalliche Srl", "SUBCONTRACTOR"),
    "OUT": ("Azienda Esterna Srl", None),  # non partecipa al progetto
}

# chiave: (organizzazione, ruolo di sistema o None, org admin?)
USERS = {
    "platform": ("COM", None, False),
    "com_admin": ("COM", "PROJECT_ADMIN", True),
    "com_im": ("COM", "INFORMATION_MANAGER", False),
    "com_dl": ("COM", "DIRETTORE_LAVORI", False),
    "des_lead": ("DES", "LEAD_DESIGNER", False),
    "des_designer": ("DES", "DESIGNER", False),
    "des_viewer": ("DES", "VIEWER", False),
    "des_admin": ("DES", "ORG_ADMIN", True),
    "gc_admin": ("GCO", "ORG_ADMIN", True),
    "sub1_user": ("SUB1", "SUBCONTRACTOR", False),
    "sub1_viewer": ("SUB1", "VIEWER", False),
    "sub1_admin": ("SUB1", "ORG_ADMIN", True),
    "sub1_nomember": ("SUB1", None, False),
    "sub2_user": ("SUB2", "SUBCONTRACTOR", False),
    "out_user": ("OUT", None, True),
}

CONTAINERS = {
    # chiave: (org proprietaria, padre, nome)
    "des_root": ("DES", None, "DES - Progetto architettonico"),
    "des_arch": ("DES", "des_root", "Tavole architettoniche"),
    "des_arch_det": ("DES", "des_arch", "Dettagli costruttivi"),
    "des_private": ("DES", "des_root", "Calcoli interni"),
    "sub1_root": ("SUB1", None, "SUB1 - Impianti elettrici"),
    "sub2_root": ("SUB2", None, "SUB2 - Strutture metalliche"),
    "com_root": ("COM", None, "COM - Documenti committente"),
}


@dataclass
class DemoWorld:
    project_id: uuid.UUID
    project2_id: uuid.UUID
    orgs: dict[str, uuid.UUID] = field(default_factory=dict)
    users: dict[str, uuid.UUID] = field(default_factory=dict)
    roles: dict[str, uuid.UUID] = field(default_factory=dict)
    containers: dict[str, uuid.UUID] = field(default_factory=dict)
    emails: dict[str, str] = field(default_factory=dict)


def seed(owner_uri: str, *, password: str = DEMO_PASSWORD) -> DemoWorld:
    pwd_hash = PasswordHasher().hash(password)
    with psycopg.connect(owner_uri) as conn, conn.transaction():
        cur = conn.cursor()
        roles = dict(cur.execute("SELECT code, id FROM cde.roles WHERE project_id IS NULL").fetchall())

        orgs: dict[str, uuid.UUID] = {}
        for code, (name, _) in ORGS.items():
            orgs[code] = cur.execute(
                "INSERT INTO cde.organizations (legal_name, code, mfa_required) VALUES (%s, %s, false) RETURNING id",
                [name, code],
            ).fetchone()[0]

        users: dict[str, uuid.UUID] = {}
        emails: dict[str, str] = {}
        for key, (org, _, is_admin) in USERS.items():
            email = f"{key.replace('_', '.')}@{org.lower()}.example"
            users[key] = cur.execute(
                """INSERT INTO cde.users (organization_id, email, first_name, last_name, password_hash, status,
                                          is_org_admin, is_platform_admin, password_changed_at)
                   VALUES (%s, %s, %s, %s, %s, 'ACTIVE', %s, %s, now()) RETURNING id""",
                [orgs[org], email, key.split("_")[0].title(), key.split("_")[-1].title(), pwd_hash,
                 is_admin, key == "platform"],
            ).fetchone()[0]
            emails[key] = email

        project_id = cur.execute(
            """INSERT INTO cde.projects (owner_organization_id, code, name, status, created_by)
               VALUES (%s, 'PRJ01', 'Nuovo Ospedale Nord', 'ACTIVE', %s) RETURNING id""",
            [orgs["COM"], users["com_admin"]],
        ).fetchone()[0]
        for code, (_, party_role) in ORGS.items():
            if party_role:
                cur.execute(
                    "INSERT INTO cde.project_organizations (project_id, organization_id, party_role) VALUES (%s,%s,%s)",
                    [project_id, orgs[code], party_role],
                )
        for key, (_, role, _) in USERS.items():
            if role:
                cur.execute(
                    "INSERT INTO cde.project_memberships (project_id, user_id, role_id) VALUES (%s, %s, %s)",
                    [project_id, users[key], roles[role]],
                )

        containers: dict[str, uuid.UUID] = {}
        for key, (org, parent, name) in CONTAINERS.items():
            containers[key] = cur.execute(
                """INSERT INTO cde.containers (project_id, parent_id, owner_organization_id, name)
                   VALUES (%s, %s, %s, %s) RETURNING id""",
                [project_id, containers.get(parent), orgs[org], name],
            ).fetchone()[0]
        # "Calcoli interni" non eredita i grant del padre
        cur.execute("UPDATE cde.containers SET inherit_permissions = false WHERE id = %s", [containers["des_private"]])

        # Secondo progetto dell'organizzazione esterna: nessuno del progetto 1 deve vederlo
        project2_id = cur.execute(
            """INSERT INTO cde.projects (owner_organization_id, code, name, status, created_by)
               VALUES (%s, 'EXT01', 'Progetto esterno', 'ACTIVE', %s) RETURNING id""",
            [orgs["OUT"], users["out_user"]],
        ).fetchone()[0]
        cur.execute(
            "INSERT INTO cde.project_organizations (project_id, organization_id, party_role) VALUES (%s,%s,'APPOINTING_PARTY')",
            [project2_id, orgs["OUT"]],
        )
        cur.execute(
            "INSERT INTO cde.project_memberships (project_id, user_id, role_id) VALUES (%s, %s, %s)",
            [project2_id, users["out_user"], roles["PROJECT_ADMIN"]],
        )
        containers["out_root"] = cur.execute(
            """INSERT INTO cde.containers (project_id, owner_organization_id, name)
               VALUES (%s, %s, 'OUT - Riservato') RETURNING id""",
            [project2_id, orgs["OUT"]],
        ).fetchone()[0]

    return DemoWorld(project_id=project_id, project2_id=project2_id, orgs=orgs, users=users,
                     roles=roles, containers=containers, emails=emails)
