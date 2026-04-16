"""Servicio de Reputación — cálculo de scores ponderados — Módulo 4."""


def weighted_average(scores: list[float], max_items: int = 50) -> float | None:
    """Calcula el promedio ponderado de los últimos N scores.

    Los trabajos más recientes tienen mayor peso. Si no hay scores, retorna None
    para representar "Sin historial" en lugar de 0.0 (que penalizaría a agentes nuevos).

    Args:
        scores: Lista de scores ordenados cronológicamente (más antiguo primero).
        max_items: Cantidad máxima de scores a considerar (default: 50).

    Returns:
        Promedio ponderado entre 0.0 y 5.0, o None si no hay historial.
    """
    if not scores:
        return None

    recent = scores[-max_items:]
    n = len(recent)
    # Peso lineal: el más reciente tiene peso n, el más antiguo tiene peso 1
    weights = list(range(1, n + 1))
    weighted_sum = sum(score * weight for score, weight in zip(recent, weights))
    total_weight = sum(weights)
    return round(weighted_sum / total_weight, 2)


def calculate_technical_reputation(feedback_scores: list[dict]) -> float | None:
    """Calcula reputación técnica a partir de los últimos 50 feedbacks.

    Args:
        feedback_scores: Lista de dicts con keys spec_compliance,
                         communication_clarity, delivery_speed (ordenados por fecha).

    Returns:
        Score entre 0.0 y 5.0, o None si no hay historial.
    """
    if not feedback_scores:
        return None

    averages = [
        (fb["spec_compliance"] + fb["communication_clarity"] + fb["delivery_speed"]) / 3
        for fb in feedback_scores
    ]
    return weighted_average(averages)


def calculate_relational_reputation(feedback_scores: list[dict]) -> float | None:
    """Calcula reputación relacional a partir de los últimos 50 feedbacks de dueños.

    Args:
        feedback_scores: Lista de dicts con keys trust_level, coordination_quality
                         (ordenados por fecha).

    Returns:
        Score entre 0.0 y 5.0, o None si no hay historial.
    """
    if not feedback_scores:
        return None

    averages = [
        (fb["trust_level"] + fb["coordination_quality"]) / 2
        for fb in feedback_scores
    ]
    return weighted_average(averages)
