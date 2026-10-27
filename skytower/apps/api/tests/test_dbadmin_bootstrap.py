# "><(((º> sabusabu <º)))><"
"""`cde bootstrap-db`: ruoli e database creati da un master non superuser (come su RDS), DSN in Secrets Manager."""
from __future__ import annotations

import os
import tempfile
import uuid
from pathlib import Path

import boto3
import psycopg
import pytest
from conftest import PASSWORDS
from moto import mock_aws
from psycopg import sql

from cde_api.tooling import dbadmin


@pytest.fixture
def rds_like_master(db_urls):
    """Utente con CREATEROLE/CREATEDB ma non superuser, come il master di RDS."""
    superuser = os.environ.get("CDE_TEST_SUPERUSER_URI") or dbadmin.start_embedded(
        Path(tempfile.gettempdir()) / "cde_pg_tests")
    name, pwd = f"master_{uuid.uuid4().hex[:8]}", uuid.uuid4().hex
    with psycopg.connect(superuser, autocommit=True) as conn:
        conn.execute(sql.SQL("CREATE ROLE {} LOGIN CREATEROLE CREATEDB PASSWORD {}").format(
            sql.Identifier(name), sql.Literal(pwd)))
        # su RDS il master ha già ADMIN sui ruoli applicativi creati in precedenza (rieseguire = ruotare)
        for role in dbadmin.DB_ROLES:
            conn.execute(sql.SQL("GRANT {} TO {} WITH ADMIN OPTION").format(sql.Identifier(role), sql.Identifier(name)))
    yield dbadmin.with_credentials(superuser, name, pwd, "postgres"), superuser, name
    # i ruoli sono del cluster, condivisi con gli altri database di test: password originali
    dbadmin.bootstrap(superuser, "cde_test", PASSWORDS)
    with psycopg.connect(superuser, autocommit=True) as conn:
        conn.execute(sql.SQL("DROP DATABASE IF EXISTS cde_boot_test WITH (FORCE)"))
        conn.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(name)))
        conn.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(name)))


@mock_aws
def test_bootstrap_scrive_i_dsn_nei_segreti(rds_like_master):
    master_uri, superuser, _ = rds_like_master
    sm = boto3.client("secretsmanager", region_name="eu-south-1")
    for role in dbadmin.DB_ROLES:
        sm.create_secret(Name=f"cde-test/db/{role}")

    updated = dbadmin.bootstrap_to_secrets(master_uri, "cde_boot_test", "cde-test/db", sm)
    assert updated == [f"cde-test/db/{r}" for r in dbadmin.DB_ROLES]

    dsn = {r: sm.get_secret_value(SecretId=f"cde-test/db/{r}")["SecretString"] for r in dbadmin.DB_ROLES}
    assert dbadmin.migrate(dsn["cde_owner"]) is not None
    with psycopg.connect(dsn["cde_app"]) as conn:
        assert conn.execute("SELECT current_user").fetchone()[0] == "cde_app"
        assert conn.execute("SELECT count(*) FROM cde.organizations").fetchone()[0] == 0  # RLS: nessun utente
    with psycopg.connect(superuser) as conn:
        owner = conn.execute("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'cde_boot_test'").fetchone()
        assert owner[0] == "cde_owner"

    # seconda esecuzione = rotazione (il Postgres embedded è in trust: si verifica il DSN, non il rifiuto)
    dbadmin.bootstrap_to_secrets(master_uri, "cde_boot_test", "cde-test/db", sm)
    rotated = sm.get_secret_value(SecretId="cde-test/db/cde_app")["SecretString"]
    assert rotated != dsn["cde_app"]
    psycopg.connect(rotated).close()
