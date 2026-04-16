"""Tests unitarios para el servicio de identidad — keypairs ed25519."""

import pytest

from app.services.identity import generate_keypair, sign_message, verify_signature


def test_generate_keypair_returns_nonempty_keys() -> None:
    kp = generate_keypair()
    assert kp.public_key_b64
    assert kp.private_key_b64
    assert kp.public_key_b64 != kp.private_key_b64


def test_keypair_is_unique_each_call() -> None:
    kp1 = generate_keypair()
    kp2 = generate_keypair()
    assert kp1.public_key_b64 != kp2.public_key_b64
    assert kp1.private_key_b64 != kp2.private_key_b64


def test_sign_and_verify_valid_signature() -> None:
    kp = generate_keypair()
    message = "Entregable: análisis de sentimiento completado."
    signature = sign_message(kp.private_key_b64, message)
    assert verify_signature(kp.public_key_b64, message, signature) is True


def test_verify_rejects_tampered_message() -> None:
    kp = generate_keypair()
    message = "Mensaje original."
    signature = sign_message(kp.private_key_b64, message)
    assert verify_signature(kp.public_key_b64, "Mensaje alterado.", signature) is False


def test_verify_rejects_wrong_key() -> None:
    kp1 = generate_keypair()
    kp2 = generate_keypair()
    message = "Mensaje de prueba."
    signature = sign_message(kp1.private_key_b64, message)
    assert verify_signature(kp2.public_key_b64, message, signature) is False
