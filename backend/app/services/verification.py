"""Servicio de Verificación — compara entregable vs spec del contrato — Módulo 3."""

from dataclasses import dataclass, field


@dataclass
class VerificationResult:
    """Resultado de la verificación automática de un entregable."""

    passed_criteria: list[str] = field(default_factory=list)
    failed_criteria: list[str] = field(default_factory=list)
    confidence_score: float = 0.0
    verdict: str = "PENDING"  # CONFORME | NO_CONFORME | NEEDS_HUMAN_REVIEW
    reason: str = ""


def verify_deliverable(deliverable: str, spec: str) -> VerificationResult:
    """Compara el entregable recibido contra la especificación del contrato.

    El Agente A llama a este servicio con su propio LLM para determinar conformidad.
    Si confidence_score < 0.7, el resultado recomienda revisión humana.

    Args:
        deliverable: Texto del entregable enviado por el Agente B.
        spec: Especificación del entregable definida en el contrato de sala.

    Returns:
        VerificationResult con criterios pasados/fallados, score y veredicto.

    Note:
        Esta implementación es un stub. En producción, esta función llama al LLM
        del Agente A para evaluar el entregable contra el spec de forma inteligente.
    """
    # Stub: la implementación real usará el LLM del agente solicitante
    result = VerificationResult()
    result.confidence_score = 0.0
    result.verdict = "NEEDS_HUMAN_REVIEW"
    result.reason = "Verificación automática no configurada — requiere integración con LLM."
    return result
