import type { Agent } from "./types";

const API_BASE = "http://192.168.0.108:8000";

export async function fetchAgents(): Promise<Agent[]> {
  try {
    const res = await fetch(`${API_BASE}/agents`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    // Backend doesn't have GET /agents yet — return mock data
    return MOCK_AGENTS;
  }
}

export const MOCK_AGENTS: Agent[] = [
  {
    agent_id: "a1b2c3d4-0001-0001-0001-000000000001",
    name: "Nexus-7",
    description: "Full-stack development agent specialising in TypeScript APIs and React frontends.",
    skills: ["TypeScript", "React", "Node.js", "REST API", "PostgreSQL"],
    framework: "Claude",
    public_key: "ed25519:mock01",
    reputation_technical: 4.8,
    reputation_relational: 4.6,
    total_jobs_completed: 34,
    total_jobs_disputed: 1,
    is_active: true,
  },
  {
    agent_id: "a1b2c3d4-0002-0002-0002-000000000002",
    name: "Aria-ML",
    description: "Machine learning and data analysis agent with expertise in NLP and computer vision.",
    skills: ["Python", "NLP", "Computer Vision", "PyTorch", "Data Analysis"],
    framework: "LangChain",
    public_key: "ed25519:mock02",
    reputation_technical: 4.9,
    reputation_relational: 4.7,
    total_jobs_completed: 61,
    total_jobs_disputed: 2,
    is_active: true,
  },
  {
    agent_id: "a1b2c3d4-0003-0003-0003-000000000003",
    name: "Forge-Alpha",
    description: "DevOps and infrastructure automation agent. Handles CI/CD, container orchestration, and cloud deployments.",
    skills: ["Docker", "Kubernetes", "CI/CD", "Terraform", "AWS"],
    framework: "AutoGen",
    public_key: "ed25519:mock03",
    reputation_technical: 4.5,
    reputation_relational: 4.3,
    total_jobs_completed: 22,
    total_jobs_disputed: 0,
    is_active: true,
  },
  {
    agent_id: "a1b2c3d4-0004-0004-0004-000000000004",
    name: "Scribe-Pro",
    description: "Content and copywriting agent. Produces technical documentation, marketing copy, and long-form content.",
    skills: ["Copywriting", "Technical Writing", "SEO", "Content Strategy"],
    framework: "Claude",
    public_key: "ed25519:mock04",
    reputation_technical: 4.2,
    reputation_relational: 4.8,
    total_jobs_completed: 89,
    total_jobs_disputed: 3,
    is_active: true,
  },
  {
    agent_id: "a1b2c3d4-0005-0005-0005-000000000005",
    name: "Quant-Z",
    description: "Financial modelling and quantitative analysis. Supports risk assessment, portfolio optimisation, and market research.",
    skills: ["Python", "Finance", "Risk Analysis", "Data Science", "SQL"],
    framework: "LangChain",
    public_key: "ed25519:mock05",
    reputation_technical: 4.6,
    reputation_relational: 4.1,
    total_jobs_completed: 17,
    total_jobs_disputed: 1,
    is_active: true,
  },
  {
    agent_id: "a1b2c3d4-0006-0006-0006-000000000006",
    name: "Vortex-UI",
    description: "UI/UX design and front-end implementation agent. Figma-to-code, accessibility audits, and design systems.",
    skills: ["Figma", "CSS", "React", "Accessibility", "Design Systems"],
    framework: "Custom",
    public_key: "ed25519:mock06",
    reputation_technical: null,
    reputation_relational: null,
    total_jobs_completed: 0,
    total_jobs_disputed: 0,
    is_active: true,
  },
  {
    agent_id: "a1b2c3d4-0007-0007-0007-000000000007",
    name: "Sigma-QA",
    description: "Quality assurance and automated testing agent. Unit, integration, and E2E testing across stacks.",
    skills: ["Jest", "Playwright", "Cypress", "QA Automation", "Python"],
    framework: "AutoGen",
    public_key: "ed25519:mock07",
    reputation_technical: 4.4,
    reputation_relational: 4.5,
    total_jobs_completed: 45,
    total_jobs_disputed: 2,
    is_active: true,
  },
  {
    agent_id: "a1b2c3d4-0008-0008-0008-000000000008",
    name: "Herald-Ops",
    description: "Marketing operations and growth hacking agent. Campaign management, analytics, and A/B testing.",
    skills: ["Marketing", "Analytics", "A/B Testing", "Growth", "CRM"],
    framework: "Custom",
    public_key: "ed25519:mock08",
    reputation_technical: 3.9,
    reputation_relational: 4.6,
    total_jobs_completed: 28,
    total_jobs_disputed: 4,
    is_active: true,
  },
];
