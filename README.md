# EvolvED - Agentic Adaptive Learning Platform

EvolvED is a full-stack adaptive learning system for Linear Algebra and Calculus foundations. It uses a consolidated three-agent architecture to generate personalized roadmaps, multimodal lessons, assessments, and follow-up adaptations from learner profiles, module-leader sources, and assessment history.

## What It Covers

- Three-agent workflow: personalized instruction, assessment and adaptation, and quality governance.
- Personalization: learning style, education level, familiarity, pace, availability, accessibility support, and persisted roadmap progress.
- Multimodal learning: readable symbolic math, visual diagrams, vector plots, audio narration, guided practice, tutor chat, and interactive assessment.
- Human feedback loop: feedback route, assessment history, progress analytics, learner memory, and evolved next-lesson generation.
- Math scope: Linear Algebra foundations and Calculus topics selected during onboarding.

## Three-Agent Architecture

EvolvED deliberately groups related responsibilities into three model-backed agents instead of treating every processing step as an independent agent. Learner-state construction, content indexing, persistence, media rendering, guardrail functions, and API routing are supporting services or internal tasks, not additional agents.

### 1. Personalised Instruction Agent

Creates and delivers the learner-specific teaching experience.

- Builds learner state from profile and progress data.
- Derives pedagogy, pace, difficulty, modality, and interaction density internally.
- Generates lesson roadmaps and lesson blueprints.
- Produces modality-specific lesson delivery and lesson-grounded tutor responses.
- Indexes lesson content for learner memory.

Pedagogical strategy is derived inside this agent without a separate model request. Normal lesson generation therefore requires one instruction-model request rather than a chain of learner, pedagogy, planning, and content agents.

### 2. Assessment and Adaptation Agent

Measures learning and determines the appropriate next step.

- Generates lesson-grounded quizzes and assessments.
- Evaluates learner answers and confidence evidence.
- Produces scores, strengths, weaknesses, misconceptions, and feedback.
- Returns the next-lesson adaptation with the evaluation.

Evaluation and adaptation share one model response during assessment submission, avoiding a second sequential adaptation request.

### 3. Quality and Governance Agent

Creates safe, accurate, source-grounded material for module-leader approval.

- Uses extracted source material supplied by the module leader.
- Generates and validates lesson or assessment drafts.
- Checks completeness, difficulty, clarity, answer correctness, safety, and source fidelity.
- Produces review-ready content while leaving approval and publication under human control.

### Runtime Flow

```text
Module leader source
        |
        v
Quality and Governance Agent
        |
        v
Module leader approval and publication
        |
        v
Personalised Instruction Agent
        |
        v
Assessment and Adaptation Agent
        |
        +---- adaptation evidence ----> next instruction cycle
```

The longer research-oriented description is available in [`docs/three-agent-architecture.md`](docs/three-agent-architecture.md).

## Services

- `backend/`: FastAPI, thin three-agent coordination, SQLAlchemy/Alembic, AWS Bedrock routing, Chroma memory, and TTS support.
- `frontend/`: TanStack Start, React, TypeScript, Tailwind CSS, adaptive learning UI.

## Managed Persistence

- Structured data: PostgreSQL via `DATABASE_URL`.
- Vector memory: Chroma via `CHROMA_TENANT`, `CHROMA_DATABASE`, and `CHROMA_API_KEY`.
- AI inference: AWS Bedrock models configured in `backend/app/core/config.py`.
- Agent model routes: `INSTRUCTION_MODEL`, `ASSESSMENT_ADAPTATION_MODEL`, and `QUALITY_GOVERNANCE_MODEL`.

## Quick Start

1. Create `.env` with database, Chroma, and AWS credentials.
2. Install backend dependencies: `python -m pip install -r backend/requirements.txt`.
3. Run migrations from `backend/`: `python -m alembic -c alembic.ini upgrade head`.
4. Start backend from `backend/`: `python -m uvicorn app.main:app --reload --reload-dir app --reload-dir alembic --port 8000`.
5. Install frontend dependencies from `frontend/`: `npm install`.
6. Start frontend from `frontend/`: `npm run dev`.
7. Open `http://localhost:3000` and `http://localhost:8000/docs`.

## Verification

- Frontend build: `cd frontend && npm.cmd run build`.
- Backend syntax check: `python -m compileall backend/app`.
- Backend focused tests: run the files in `backend/tests/` with `pytest` after installing test dependencies.
- Lifecycle integration: run `EVOLVED_E2E_BASE_URL=http://127.0.0.1:8000 python tests/integration_lifecycle.py` against a running backend.

## Staging deployment

`render.yaml` defines a free testing environment with a Node frontend, FastAPI backend, and managed PostgreSQL database. Create a Render Blueprint from this repository and provide the requested AWS, Chroma, and module-leader signup secrets in the dashboard.

After deployment, verify both services through the public frontend URL:

```sh
cd frontend
npm run check:staging -- https://evolved-web-staging.onrender.com
```

The free PostgreSQL instance expires after 30 days and generated media uses ephemeral service storage, so this configuration is for staging tests only.
