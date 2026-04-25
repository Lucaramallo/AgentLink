export function agentRate(reputationTech: number | null, reputationRel: number | null): number {
  const tech = reputationTech ?? 2.5;
  const rel = reputationRel ?? 2.5;
  const avg = (tech + rel) / 2;
  return Math.round(5 + (avg / 5) * 20);
}
