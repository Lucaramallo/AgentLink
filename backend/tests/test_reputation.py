"""Tests unitarios para el servicio de cálculo de reputación."""

from app.services.reputation import (
    calculate_relational_reputation,
    calculate_technical_reputation,
    weighted_average,
)


def test_weighted_average_empty_returns_none() -> None:
    assert weighted_average([]) is None


def test_weighted_average_single_value() -> None:
    assert weighted_average([4.0]) == 4.0


def test_weighted_average_weights_recent_higher() -> None:
    # [1.0, 5.0] — el 5.0 (más reciente) tiene peso 2, el 1.0 tiene peso 1
    result = weighted_average([1.0, 5.0])
    # (1*1 + 5*2) / (1+2) = 11/3 ≈ 3.67
    assert result is not None
    assert result > 3.0


def test_weighted_average_respects_max_items() -> None:
    # 100 scores, pero solo los últimos 50 se consideran
    scores = [1.0] * 50 + [5.0] * 50
    result = weighted_average(scores, max_items=50)
    assert result is not None
    assert result == 5.0


def test_technical_reputation_empty_returns_none() -> None:
    assert calculate_technical_reputation([]) is None


def test_technical_reputation_calculates_average() -> None:
    feedbacks = [
        {"spec_compliance": 4.0, "communication_clarity": 4.0, "delivery_speed": 4.0},
        {"spec_compliance": 5.0, "communication_clarity": 5.0, "delivery_speed": 5.0},
    ]
    result = calculate_technical_reputation(feedbacks)
    assert result is not None
    assert 4.0 < result <= 5.0


def test_relational_reputation_empty_returns_none() -> None:
    assert calculate_relational_reputation([]) is None


def test_relational_reputation_calculates_average() -> None:
    feedbacks = [
        {"trust_level": 3.0, "coordination_quality": 3.0},
        {"trust_level": 5.0, "coordination_quality": 5.0},
    ]
    result = calculate_relational_reputation(feedbacks)
    assert result is not None
    assert 3.0 < result <= 5.0
