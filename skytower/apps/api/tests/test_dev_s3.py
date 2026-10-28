# "><(((º> sabusabu <º)))><"
"""S3 emulato di `cde dev` salvato su disco: un oggetto scritto in un processo si rilegge in un altro con la
stessa versione e il bucket resta con l'Object Lock. Due processi veri, perché lo stato di moto è globale."""
from __future__ import annotations

import socket
import subprocess
import sys
import textwrap

SCRIPT = textwrap.dedent("""
    import sys, time
    from pathlib import Path
    import boto3
    from cde_api.tooling import dev_s3

    mode, state, port = sys.argv[1], Path(sys.argv[2]), int(sys.argv[3])
    s3 = boto3.client("s3", endpoint_url=dev_s3.start(port, state), region_name="eu-south-1")
    if mode == "scrivi":
        s3.create_bucket(Bucket="cde-prova", ObjectLockEnabledForBucket=True,
                         CreateBucketConfiguration={"LocationConstraint": "eu-south-1"})
        print(s3.put_object(Bucket="cde-prova", Key="a/b.pdf", Body=b"%PDF" * 500)["VersionId"])
        for _ in range(50):                      # il salvataggio è asincrono: si aspetta il file
            if state.exists():
                break
            time.sleep(0.2)
    else:
        o = s3.get_object(Bucket="cde-prova", Key="a/b.pdf", VersionId=sys.argv[4])
        lock = s3.get_object_lock_configuration(Bucket="cde-prova")["ObjectLockConfiguration"]["ObjectLockEnabled"]
        print(len(o["Body"].read()), lock)
""")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _run(*args: str) -> str:
    out = subprocess.run([sys.executable, "-c", SCRIPT, *args],  # noqa: S603 - script del test, argomenti nostri
                         capture_output=True, text=True, timeout=120, check=True)
    return out.stdout.strip().splitlines()[-1]


def test_file_conservati_tra_due_avvii(tmp_path):
    state = tmp_path / "s3-state.pkl"
    version = _run("scrivi", str(state), str(_free_port()))
    assert state.exists() and not state.with_suffix(".tmp").exists()
    assert _run("leggi", str(state), str(_free_port()), version) == "2000 Enabled"
