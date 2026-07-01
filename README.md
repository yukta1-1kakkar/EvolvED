# EvolvED - Agentic Adaptive Learning Platform

EvolvED is a full-stack adaptive learning system for Linear Algebra and Calculus foundations. It generates personalized roadmaps, multimodal lessons, quizzes, assessments, and follow-up adaptations from a learner profile and assessment history.

## What It Covers

- Agentic workflow: learner modeling, pedagogical strategy, lesson planning, content generation, quiz generation, assessment, adaptation, and memory retrieval.
- Personalization: learning style, education level, familiarity, pace, availability, accessibility support, and persisted roadmap progress.
- Multimodal learning: readable symbolic math, visual diagrams, vector plots, audio narration, guided practice, tutor chat, and interactive assessment.
- Human feedback loop: feedback route, assessment history, progress analytics, learner memory, and evolved next-lesson generation.
- Math scope: Linear Algebra foundations and Calculus topics selected during onboarding.

## Services

- `backend/`: FastAPI, LangGraph-style orchestration, SQLAlchemy/Alembic, AWS Bedrock routing, Chroma memory, TTS support.
- `frontend/`: TanStack Start, React, TypeScript, Tailwind CSS, adaptive learning UI.

## Managed Persistence

- Structured data: PostgreSQL via `DATABASE_URL`.
- Vector memory: Chroma via `CHROMA_TENANT`, `CHROMA_DATABASE`, and `CHROMA_API_KEY`.
- AI inference: AWS Bedrock models configured in `backend/app/core/config.py`.

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
