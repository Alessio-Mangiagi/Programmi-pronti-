# "><(((º> sabusabu <º)))><"
"""JWT di accesso RS256 (15'), token parziale MFA, refresh token opachi."""
from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid
from dataclasses import dataclass

import jwt
from cryptography.hazmat.primitives import serialization

from ..config import Settings

ACCESS = "access"
MFA_PENDING = "mfa_pending"


@dataclass(frozen=True)
class AccessClaims:
    user_id: uuid.UUID
    org_id: uuid.UUID
    mfa: bool
    amr: list[str]
    jti: str


class TokenService:
    def __init__(self, settings: Settings, private_key_pem: bytes):
        self.s = settings
        self._private = serialization.load_pem_private_key(private_key_pem, password=None)
        self._public = self._private.public_key()
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self._public))
        self.kid = hashlib.sha256(jwk["n"].encode()).hexdigest()[:16]
        self.jwks = {"keys": [{**jwk, "kid": self.kid, "use": "sig", "alg": "RS256"}]}

    def _encode(self, claims: dict, ttl: int) -> str:
        now = int(time.time())
        payload = {"iss": self.s.jwt_issuer, "aud": self.s.jwt_audience, "iat": now, "exp": now + ttl,
                   "jti": str(uuid.uuid4()), **claims}
        return jwt.encode(payload, self._private, algorithm="RS256", headers={"kid": self.kid})

    def _decode(self, token: str, typ: str) -> dict:
        payload = jwt.decode(token, self._public, algorithms=["RS256"], audience=self.s.jwt_audience,
                             issuer=self.s.jwt_issuer, options={"require": ["exp", "iat", "sub", "typ"]})
        if payload["typ"] != typ:
            raise jwt.InvalidTokenError("tipo di token errato")
        return payload

    def issue_access(self, user_id: uuid.UUID, org_id: uuid.UUID, amr: list[str]) -> str:
        return self._encode({"typ": ACCESS, "sub": str(user_id), "org": str(org_id), "amr": amr,
                             "mfa": "otp" in amr or "hwk" in amr}, self.s.access_token_ttl_s)

    def decode_access(self, token: str) -> AccessClaims:
        p = self._decode(token, ACCESS)
        return AccessClaims(uuid.UUID(p["sub"]), uuid.UUID(p["org"]), bool(p.get("mfa")), p.get("amr", []), p["jti"])

    def issue_mfa_pending(self, user_id: uuid.UUID, *, enroll: bool) -> str:
        """Token parziale dopo la password: abilita solo verifica (o enrollment obbligatorio) MFA."""
        return self._encode({"typ": MFA_PENDING, "sub": str(user_id), "enroll": enroll}, self.s.mfa_pending_ttl_s)

    def decode_mfa_pending(self, token: str) -> tuple[uuid.UUID, bool]:
        p = self._decode(token, MFA_PENDING)
        return uuid.UUID(p["sub"]), bool(p.get("enroll"))


    def issue_sse_ticket(self, user_id: uuid.UUID) -> str:
        """Ticket di 60" per aprire lo stream SSE (EventSource non invia header Authorization)."""
        return self._encode({"typ": SSE, "sub": str(user_id)}, 60)

    def decode_sse_ticket(self, token: str) -> uuid.UUID:
        return uuid.UUID(self._decode(token, SSE)["sub"])


SSE = "sse"


def new_opaque_token() -> tuple[str, bytes]:
    """Restituisce (token da consegnare al client, hash SHA-256 da salvare)."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()
