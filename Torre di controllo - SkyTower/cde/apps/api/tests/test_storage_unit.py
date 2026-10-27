# "><(((º> sabusabu <º)))><"
"""Pianificazione multipart per file grandi (G19) e scanner EICAR."""
import pytest

from cde_api.scanner import EICAR, EicarScanner
from cde_api.storage import MAX_PARTS, MIN_PART, plan_parts

MB, GB = 1024 ** 2, 1024 ** 3


@pytest.mark.parametrize("size, expected_parts", [
    (1, 1), (64 * MB, 1), (64 * MB + 1, 2), (2 * GB, 32), (5 * GB, 80), (50 * GB, 800),
])
def test_parti_da_64_mb(size, expected_parts):
    part_size, count = plan_parts(size, 64 * MB)
    assert part_size == 64 * MB and count == expected_parts


def test_file_enorme_aumenta_la_dimensione_parte():
    part_size, count = plan_parts(1024 * GB, 64 * MB)
    assert count <= MAX_PARTS and part_size * count >= 1024 * GB


def test_parte_minima_s3():
    assert plan_parts(20 * MB, 1 * MB)[0] == MIN_PART


def test_eicar_a_cavallo_di_due_chunk():
    half = len(EICAR) // 2
    assert not EicarScanner().scan([b"x" * 100 + EICAR[:half], EICAR[half:] + b"y"]).clean
    assert EicarScanner().scan([b"pulito", b"ancora pulito"]).clean
