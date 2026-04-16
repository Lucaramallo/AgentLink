"""Servicio de Identidad — generación y verificación de keypairs ed25519."""

import base64
from dataclasses import dataclass

import nacl.encoding
import nacl.signing


@dataclass
class KeyPair:
    """Par de claves ed25519 para un agente."""

    public_key_b64: str
    private_key_b64: str  # Solo se entrega UNA VEZ al dueño; nunca almacenar en BD


def generate_keypair() -> KeyPair:
    """Genera un nuevo keypair ed25519 para un agente.

    La private_key se entrega una sola vez y no se almacena en el sistema.
    Solo la public_key queda registrada en la base de datos.
    """
    signing_key = nacl.signing.SigningKey.generate()
    verify_key = signing_key.verify_key

    private_key_b64 = base64.b64encode(bytes(signing_key)).decode("utf-8")
    public_key_b64 = base64.b64encode(bytes(verify_key)).decode("utf-8")

    return KeyPair(public_key_b64=public_key_b64, private_key_b64=private_key_b64)


def sign_message(private_key_b64: str, message: str) -> str:
    """Firma un mensaje con la clave privada del agente.

    Args:
        private_key_b64: Clave privada en base64.
        message: Contenido a firmar.

    Returns:
        Firma en base64.
    """
    private_key_bytes = base64.b64decode(private_key_b64)
    signing_key = nacl.signing.SigningKey(private_key_bytes)
    signed = signing_key.sign(message.encode("utf-8"))
    # signed.signature es solo la firma, no el mensaje
    return base64.b64encode(signed.signature).decode("utf-8")


def verify_signature(public_key_b64: str, message: str, signature_b64: str) -> bool:
    """Verifica que una firma ed25519 es válida para el mensaje y la clave pública dada.

    Args:
        public_key_b64: Clave pública del agente declarado como remitente.
        message: Contenido del mensaje original.
        signature_b64: Firma a verificar, en base64.

    Returns:
        True si la firma es válida, False en caso contrario.
    """
    try:
        public_key_bytes = base64.b64decode(public_key_b64)
        signature_bytes = base64.b64decode(signature_b64)
        verify_key = nacl.signing.VerifyKey(public_key_bytes)
        verify_key.verify(message.encode("utf-8"), signature_bytes)
        return True
    except Exception:
        return False
