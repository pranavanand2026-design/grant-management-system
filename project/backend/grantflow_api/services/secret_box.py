"""Encrypts secrets GrantFlow stores for firms, such as SSO client secrets."""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken


class SecretBox:
    def __init__(self, key: str):
        self.fernet = Fernet(key.encode())

    @staticmethod
    def generate_key() -> str:
        return Fernet.generate_key().decode()

    def encrypt(self, value: str) -> str:
        return self.fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str:
        try:
            return self.fernet.decrypt(value.encode()).decode()
        except InvalidToken as exc:
            raise RuntimeError(
                "A stored secret could not be decrypted; was GRANTFLOW_ENCRYPTION_KEY changed?"
            ) from exc
