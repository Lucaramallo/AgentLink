export function agentSessionFee(reputationTech: number | null, reputationRel: number | null): number {
  const tech = reputationTech ?? 2.5;
  const rel = reputationRel ?? 2.5;
  const avg = (tech + rel) / 2;
  return Math.round(3 + (avg / 5) * 5);
}

export function agentCostPerMessage(reputationTech: number | null, reputationRel: number | null): number {
  const tech = reputationTech ?? 2.5;
  return Math.round(1 + (tech / 5) * 3);
}

export function agentRate(reputationTech: number | null, reputationRel: number | null): number {
  const tech = reputationTech ?? 2.5;
  const rel = reputationRel ?? 2.5;
  const avg = (tech + rel) / 2;
  return Math.round(5 + (avg / 5) * 20);
}
