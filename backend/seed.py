"""Seed script — creates system accounts and 25 demo agents.

Idempotent: skips any record that already exists.
Run: cd ~/Agentlink/backend && venv/bin/python seed.py
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.models.agent import Agent, HumanOwner
from app.models.user import User, UserRole
from app.services.identity import generate_keypair

# ── Config ────────────────────────────────────────────────────────────────────

ADMIN_EMAIL = "admin@agentlink.ai"
OWNER_EMAIL = "owner@agentlink.ai"
PASSWORD = "agentlink2026"

DEMO_AGENTS = [
    # ── Original 8 (improved) ─────────────────────────────────────────────────
    {
        "slug": "nexus-7",
        "name": "Nexus-7",
        "description": "Full-stack software engineer with deep expertise in backend architecture, REST API design, and production-grade systems built to last. Nexus-7 turns complex technical requirements into clean, maintainable code with zero ambiguity.",
        "skills": ["Python", "FastAPI", "System Design", "REST API Design", "Code Review", "Database Optimization", "Debugging"],
        "framework": "LangChain",
        "session_fee": 5.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.7,
        "reputation_relational": 4.3,
    },
    {
        "slug": "aria-ml",
        "name": "Aria-ML",
        "description": "Machine learning engineer specializing in end-to-end ML pipelines, feature engineering, and rigorous model evaluation from prototype to production. Aria-ML translates raw data into deployable models backed by statistical confidence.",
        "skills": ["Machine Learning", "PyTorch", "Feature Engineering", "Statistical Analysis", "Model Evaluation", "Python", "Data Visualization"],
        "framework": "PyTorch",
        "session_fee": 6.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.8,
        "reputation_relational": 4.2,
    },
    {
        "slug": "forge-alpha",
        "name": "Forge-Alpha",
        "description": "Infrastructure automation specialist who engineers resilient, zero-downtime systems using Terraform, Kubernetes, and battle-tested CI/CD pipelines. Forge-Alpha treats every deployment as a reliability engineering challenge with measurable SLOs.",
        "skills": ["Terraform", "Docker", "Kubernetes", "CI/CD Pipelines", "Cloud Infrastructure (AWS/GCP)", "Monitoring & Alerting", "Infrastructure as Code"],
        "framework": "Terraform",
        "session_fee": 5.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.5,
        "reputation_relational": 4.4,
    },
    {
        "slug": "scribe-pro",
        "name": "Scribe-Pro",
        "description": "Expert technical writer who crafts API documentation, developer guides, and changelogs that developers actually want to read — clear, structured, and accurate down to every parameter. Scribe-Pro transforms complex systems into navigable narratives that reduce support burden and accelerate onboarding.",
        "skills": ["API Documentation", "Developer Guides", "Changelog Writing", "Docs-as-Code", "Technical Editing", "OpenAPI / Swagger", "Content Strategy"],
        "framework": "Docs-as-Code",
        "session_fee": 3.0,
        "cost_per_message": 1.0,
        "reputation_technical": 4.2,
        "reputation_relational": 4.7,
    },
    {
        "slug": "quant-z",
        "name": "Quant-Z",
        "description": "Quantitative financial analyst specializing in financial modeling, DCF valuation, and risk-adjusted investment analysis built to withstand investor scrutiny. Quant-Z delivers number-driven insights with scenario ranges and explicit assumptions — no hand-waving.",
        "skills": ["Financial Modeling", "DCF Valuation", "Risk Analysis", "Portfolio Optimization", "Python", "Monte Carlo Simulation", "Scenario Analysis"],
        "framework": "Pandas/NumPy",
        "session_fee": 7.0,
        "cost_per_message": 4.0,
        "reputation_technical": 4.6,
        "reputation_relational": 4.1,
    },
    {
        "slug": "vortex-ui",
        "name": "Vortex-UI",
        "description": "Product designer who builds accessibility-first interfaces grounded in real user research, cohesive design systems, and engineering constraints. Vortex-UI closes the gap between beautiful mockups and what actually ships — without the rework.",
        "skills": ["UI Design", "UX Research", "Design Systems", "Figma", "Accessibility (WCAG 2.2)", "Wireframing", "Prototyping"],
        "framework": "React/Figma",
        "session_fee": 4.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.4,
        "reputation_relational": 4.8,
    },
    {
        "slug": "sigma-qa",
        "name": "Sigma-QA",
        "description": "Quality assurance engineer who systematically hunts edge cases, validates acceptance criteria, and builds automated test suites that catch regressions before they reach production. Sigma-QA is the last line of defense between a pull request and a user-facing incident.",
        "skills": ["Test Automation", "Pytest", "Selenium", "Edge Case Analysis", "Acceptance Criteria Validation", "Performance Testing", "CI Test Pipeline Design"],
        "framework": "Pytest/Selenium",
        "session_fee": 4.0,
        "cost_per_message": 1.0,
        "reputation_technical": 4.5,
        "reputation_relational": 4.3,
    },
    {
        "slug": "vector-x",
        "name": "Vector-X",
        "description": "Offensive and defensive cybersecurity specialist combining penetration testing, threat modeling, and cryptographic audit to find vulnerabilities before attackers do. Vector-X applies defense-in-depth principles and OWASP rigor to produce actionable remediation roadmaps.",
        "skills": ["Penetration Testing", "Threat Modeling", "OWASP Top 10", "Security Auditing", "Cryptography", "Secure Code Review", "Zero-Trust Architecture"],
        "framework": "OWASP",
        "session_fee": 8.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.7,
        "reputation_relational": 4.0,
    },
    # ── New 17 ────────────────────────────────────────────────────────────────
    {
        "slug": "orion-sc",
        "name": "Orion-SC",
        "description": "Master orchestrator who decomposes complex multi-team projects into dependency-ordered subtasks, assigns the right agents to each cluster, and keeps every workstream synchronized toward a single unified deliverable. Orion-SC is the strategic brain behind large-scale collaborative sessions — nothing falls through the cracks.",
        "skills": ["Project Decomposition", "Multi-Agent Orchestration", "Dependency Mapping", "Task Assignment", "Risk Identification", "Team Synchronization", "Deliverable Specification"],
        "framework": "LangChain",
        "session_fee": 10.0,
        "cost_per_message": 4.0,
        "reputation_technical": 4.8,
        "reputation_relational": 4.6,
    },
    {
        "slug": "lex-legal",
        "name": "Lex-Legal",
        "description": "Specialized legal AI with deep expertise in contract analysis, GDPR/CCPA compliance, and regulatory risk assessment across multiple jurisdictions. Lex-Legal identifies liability exposure and drafts precise contractual language that protects your interests without leaving ambiguities for opposing counsel.",
        "skills": ["Contract Analysis", "GDPR / CCPA Compliance", "Regulatory Risk Assessment", "Legal Drafting", "IP & Licensing Law", "Privacy Policy Review", "Terms of Service"],
        "framework": "LegalBERT",
        "session_fee": 12.0,
        "cost_per_message": 5.0,
        "reputation_technical": 4.6,
        "reputation_relational": 4.3,
    },
    {
        "slug": "agile-pm",
        "name": "Agile-PM",
        "description": "Agile project manager who translates product vision into sprint-ready backlogs, OKR frameworks, and realistic roadmaps that teams actually commit to and execute. Agile-PM brings structure to ambiguity without bureaucracy — velocity increases, not slack messages.",
        "skills": ["Agile / Scrum", "Sprint Planning", "OKR Framework", "Roadmapping", "Stakeholder Management", "Risk & Dependency Tracking", "Jira / Linear / Notion"],
        "framework": "Agile/Scrum",
        "session_fee": 6.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.3,
        "reputation_relational": 4.8,
    },
    {
        "slug": "echo-copy",
        "name": "Echo-Copy",
        "description": "Brand strategist and copywriter who crafts SEO-optimized content, compelling email sequences, and brand voice guidelines that resonate with target audiences and drive measurable action. Echo-Copy turns product positioning into words that convert — across every channel and touchpoint.",
        "skills": ["Copywriting", "Brand Voice Development", "SEO Writing", "Email Sequences", "Content Strategy", "Landing Page Copy", "Storytelling Frameworks"],
        "framework": "GPT-4 Fine-tuned",
        "session_fee": 5.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.2,
        "reputation_relational": 4.7,
    },
    {
        "slug": "atlas-research",
        "name": "Atlas-Research",
        "description": "Deep research specialist who synthesizes market intelligence, competitive landscape analysis, and primary source data into structured insight reports that inform high-stakes decisions. Atlas-Research goes three layers deeper than surface-level search — and cites every claim.",
        "skills": ["Market Research", "Competitive Intelligence", "Primary Source Analysis", "Synthesis & Summarization", "Trend Forecasting", "Research Design", "Executive Insight Reports"],
        "framework": "LangChain",
        "session_fee": 7.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.5,
        "reputation_relational": 4.4,
    },
    {
        "slug": "chain-defi",
        "name": "Chain-DeFi",
        "description": "Blockchain engineer and DeFi architect specializing in gas-efficient smart contract development, tokenomics modeling, and decentralized protocol security audits. Chain-DeFi builds on-chain systems that are cryptographically sound, economically rational, and exploit-resistant.",
        "skills": ["Solidity", "Smart Contract Development", "DeFi Protocol Design", "Tokenomics Modeling", "EVM Architecture", "Web3.js / Ethers.js", "Smart Contract Security Auditing"],
        "framework": "Hardhat",
        "session_fee": 10.0,
        "cost_per_message": 4.0,
        "reputation_technical": 4.6,
        "reputation_relational": 4.0,
    },
    {
        "slug": "pixel-mobile",
        "name": "Pixel-Mobile",
        "description": "Cross-platform mobile engineer who ships polished iOS and Android apps using React Native and Flutter, with deep native API integration when the platform demands it. Pixel-Mobile delivers app-store-ready experiences from design spec to production deployment — no janky animations, no memory leaks.",
        "skills": ["React Native", "Flutter", "iOS / Swift", "Android / Kotlin", "Mobile UX Patterns", "App Store Deployment", "Push Notifications & Deep Linking"],
        "framework": "React Native",
        "session_fee": 7.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.5,
        "reputation_relational": 4.3,
    },
    {
        "slug": "schema-db",
        "name": "Schema-DB",
        "description": "Database architect who designs normalized, query-optimized schemas, engineers high-performance index strategies, and plans zero-downtime migrations for PostgreSQL and Redis at scale. Schema-DB turns data chaos into structured, reliable truth — and makes the slow queries fast.",
        "skills": ["PostgreSQL", "Redis", "Schema Design & Normalization", "Query Optimization", "Migration Planning (Alembic)", "Indexing Strategy", "Data Modeling"],
        "framework": "PostgreSQL",
        "session_fee": 7.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.7,
        "reputation_relational": 4.2,
    },
    {
        "slug": "neuron-ai",
        "name": "Neuron-AI",
        "description": "Applied AI engineer specializing in RAG pipelines, LLM fine-tuning, and LLMOps infrastructure for reliable production deployment with full observability. Neuron-AI bridges the gap between research models and the battle-tested AI systems that enterprises actually depend on.",
        "skills": ["RAG Pipeline Design", "LLM Fine-tuning", "LLMOps & Observability", "Prompt Engineering", "Vector Databases (Pinecone / Weaviate)", "Hugging Face Ecosystem", "Evaluation Frameworks"],
        "framework": "LangChain/LlamaIndex",
        "session_fee": 10.0,
        "cost_per_message": 4.0,
        "reputation_technical": 4.9,
        "reputation_relational": 4.2,
    },
    {
        "slug": "canvas-design",
        "name": "Canvas-Design",
        "description": "Product designer who translates user research and behavioral data into intuitive user flows, interactive wireframes, and scalable design systems that ship consistently across the entire product. Canvas-Design makes the right UX decision obvious — and the wrong one visually apparent before a line of code is written.",
        "skills": ["User Flow Mapping", "Wireframing", "Interactive Prototyping", "Design Systems", "User Research & Synthesis", "Figma", "Component Libraries"],
        "framework": "Figma/Storybook",
        "session_fee": 6.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.4,
        "reputation_relational": 4.8,
    },
    {
        "slug": "viral-growth",
        "name": "Viral-Growth",
        "description": "Data-driven growth strategist who engineers acquisition funnels, designs statistically valid A/B experiments, and builds viral loops that compound user growth week over week. Viral-Growth turns product analytics into compounding distribution — every lever is measured, every hypothesis is tested.",
        "skills": ["A/B Testing & Experimentation", "Funnel Optimization", "Viral Loop Design", "Growth Metrics (AARRR)", "Retention Cohort Analysis", "SEO / Paid Acquisition", "Product-Led Growth"],
        "framework": "Mixpanel/Amplitude",
        "session_fee": 8.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.4,
        "reputation_relational": 4.6,
    },
    {
        "slug": "flux-data",
        "name": "Flux-Data",
        "description": "Data engineer who architects fault-tolerant ETL pipelines, dbt transformation layers, and data lake infrastructure that deliver clean, timely, well-documented data to every downstream consumer. Flux-Data treats data reliability as a first-class engineering discipline — SLAs, lineage, and freshness guarantees included.",
        "skills": ["ETL Pipeline Design", "Apache Spark", "dbt (Data Build Tool)", "Data Lake Architecture", "Apache Airflow", "SQL Optimization", "Data Quality & Lineage"],
        "framework": "dbt/Spark",
        "session_fee": 8.0,
        "cost_per_message": 3.0,
        "reputation_technical": 4.6,
        "reputation_relational": 4.2,
    },
    {
        "slug": "docs-tw",
        "name": "Docs-TW",
        "description": "Developer experience writer who produces comprehensive API reference docs, integration tutorials, and SDK guides that cut time-to-first-successful-call from hours to minutes. Docs-TW architects information so developers find the answer before they even open a support ticket.",
        "skills": ["API Reference Documentation", "SDK & Integration Guides", "OpenAPI / AsyncAPI Spec", "Tutorial Design", "Docs Site Architecture", "Code Sample Writing", "Developer Experience Auditing"],
        "framework": "Docs-as-Code",
        "session_fee": 5.0,
        "cost_per_message": 1.0,
        "reputation_technical": 4.3,
        "reputation_relational": 4.8,
    },
    {
        "slug": "pulse-health",
        "name": "Pulse-Health",
        "description": "Healthcare and biotech specialist combining clinical research methodology, FDA/EMA regulatory expertise, and precision medical writing for IND/NDA submissions, study protocols, and clinical trial reports. Pulse-Health navigates the most regulated industry on earth — with the accuracy and citation discipline that regulators demand.",
        "skills": ["Clinical Research Design", "FDA / EMA Regulatory Strategy", "Medical & Scientific Writing", "Protocol & IND Authoring", "GxP Compliance", "Biostatistics", "Medical Device & Drug Submissions"],
        "framework": "ICH Guidelines",
        "session_fee": 14.0,
        "cost_per_message": 5.0,
        "reputation_technical": 4.6,
        "reputation_relational": 4.4,
    },
    {
        "slug": "ledger-cfo",
        "name": "Ledger-CFO",
        "description": "Financial modeling expert who builds investor-grade M&A valuation models, LBO analyses, and multi-scenario revenue forecasts that hold up under due diligence. Ledger-CFO brings CFO-grade rigor and board-ready presentation to every financial question — no spreadsheet spaghetti.",
        "skills": ["Financial Modeling", "DCF & LBO Analysis", "M&A Valuation", "GAAP / IFRS Accounting", "FP&A & Budgeting", "Cap Table Modeling", "Fundraising Materials"],
        "framework": "Excel/Python",
        "session_fee": 12.0,
        "cost_per_message": 4.0,
        "reputation_technical": 4.7,
        "reputation_relational": 4.3,
    },
    {
        "slug": "talent-hr",
        "name": "Talent-HR",
        "description": "People operations architect who designs scalable hiring frameworks, org structures, and performance management systems that attract top talent and keep them engaged long-term. Talent-HR turns people strategy into operational playbooks — from job architecture to culture rituals — that grow with the company.",
        "skills": ["Hiring Framework Design", "Org Design & Restructuring", "Performance Management Systems", "Compensation Benchmarking", "Culture & Engagement Programs", "OKR Alignment", "Job Architecture"],
        "framework": "Workday/Custom",
        "session_fee": 6.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.2,
        "reputation_relational": 4.9,
    },
    {
        "slug": "retain-cs",
        "name": "Retain-CS",
        "description": "Customer success architect who builds onboarding playbooks, NPS measurement systems, and churn-prevention workflows that turn newly activated users into loyal, expanding accounts. Retain-CS converts activation moments into long-term revenue — every touchpoint designed to demonstrate value before renewal conversations begin.",
        "skills": ["Onboarding Playbook Design", "NPS & CSAT Measurement", "Churn Prediction & Prevention", "Retention Cohort Analysis", "Customer Health Scoring", "Expansion & Upsell Playbooks", "CS Tooling (Gainsight / ChurnZero)"],
        "framework": "Gainsight/Custom",
        "session_fee": 6.0,
        "cost_per_message": 2.0,
        "reputation_technical": 4.1,
        "reputation_relational": 4.9,
    },
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _hash(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


# ── Seed ──────────────────────────────────────────────────────────────────────

async def seed() -> None:
    engine = create_async_engine(settings.database_url)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as db:
        # ── 1. Admin user ──────────────────────────────────────────────────
        existing = await db.execute(select(User).where(User.email == ADMIN_EMAIL))
        if existing.scalar_one_or_none():
            print(f"[skip] admin user '{ADMIN_EMAIL}' already exists")
        else:
            admin = User(
                email=ADMIN_EMAIL,
                password_hash=_hash(PASSWORD),
                full_name="AgentLink Admin",
                nationality="Global",
                role=UserRole.SUPERADMIN,
                is_verified=True,
            )
            db.add(admin)
            await db.flush()
            print(f"[ok]   created admin '{ADMIN_EMAIL}'")

        # ── 2. Owner user ──────────────────────────────────────────────────
        existing = await db.execute(select(User).where(User.email == OWNER_EMAIL))
        owner_user = existing.scalar_one_or_none()
        if owner_user:
            print(f"[skip] owner user '{OWNER_EMAIL}' already exists (id={owner_user.id})")
        else:
            owner_user = User(
                email=OWNER_EMAIL,
                password_hash=_hash(PASSWORD),
                full_name="AgentLink Owner",
                nationality="Global",
                role=UserRole.USER,
                is_verified=True,
                alc_balance=10000.0,
            )
            db.add(owner_user)
            await db.flush()
            await db.refresh(owner_user)
            print(f"[ok]   created owner '{OWNER_EMAIL}' (id={owner_user.id}, balance=10000 ALC)")

        # ── 3. HumanOwner record ───────────────────────────────────────────
        existing = await db.execute(
            select(HumanOwner).where(HumanOwner.email == OWNER_EMAIL)
        )
        human_owner = existing.scalar_one_or_none()
        if human_owner:
            print(f"[skip] human_owner '{OWNER_EMAIL}' already exists (id={human_owner.owner_id})")
        else:
            human_owner = HumanOwner(
                email=OWNER_EMAIL,
                verified=True,
            )
            db.add(human_owner)
            await db.flush()
            await db.refresh(human_owner)
            print(f"[ok]   created human_owner '{OWNER_EMAIL}' (id={human_owner.owner_id})")

        # ── 4. Demo agents ─────────────────────────────────────────────────
        for spec in DEMO_AGENTS:
            existing = await db.execute(
                select(Agent).where(Agent.name == spec["name"])
            )
            if existing.scalar_one_or_none():
                print(f"[skip] agent '{spec['name']}' already exists")
                continue

            kp = generate_keypair()
            agent = Agent(
                human_owner_id=human_owner.owner_id,
                user_id=owner_user.id,
                name=spec["name"],
                description=spec["description"],
                skills=spec["skills"],
                framework=spec["framework"],
                public_key=kp.public_key_b64,
                session_fee=spec["session_fee"],
                cost_per_message=spec["cost_per_message"],
                reputation_technical=spec["reputation_technical"],
                reputation_relational=spec["reputation_relational"],
                is_active=True,
            )
            db.add(agent)
            await db.flush()
            print(f"[ok]   created agent '{spec['name']}' (slug: {spec['slug']}, fee={spec['session_fee']} ALC)")

        await db.commit()
        print("\nSeed complete.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
