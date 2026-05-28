# EvolvED — Adaptive Educational Intelligence Platform

This repository contains the EvolvED production-grade adaptive learning system scaffold.

Services:
- backend: FastAPI AI orchestration, LangGraph agents, AWS Bedrock, Neon PostgreSQL, Chroma Cloud
- frontend: Next.js (App Router), TypeScript, TailwindCSS

Managed persistence:
- Structured data: Neon PostgreSQL via `DATABASE_URL` (`postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require&channel_binding=require`)
- Vector memory: Chroma Cloud via `CHROMA_TENANT`, `CHROMA_DATABASE`, and `CHROMA_API_KEY`

Model routing:
- Pedagogical reasoning: Claude 3.7 Sonnet on AWS Bedrock
- Lesson planning: Claude 3.7 Sonnet on AWS Bedrock
- Content generation: Claude 3.7 Sonnet on AWS Bedrock
- Fast interactions: Claude 3 Haiku on AWS Bedrock
- Embeddings: Amazon Titan Text Embeddings on AWS Bedrock

Quick start (development):

1. Copy `.env.example` to `.env` and fill AWS, Neon, and Chroma Cloud values. Use a direct Neon endpoint for migration startup, not a `-pooler` endpoint.
2. Install backend dependencies: `python -m pip install -r backend/requirements.txt`.
3. From `backend/`, run `python -m alembic -c alembic.ini upgrade head`.
4. From `backend/`, run `python -m uvicorn app.main:app --reload --port 8000`.
5. In another terminal, from `frontend/`, run `npm install` and `npm run dev`.
6. Open `http://localhost:3000` for the frontend and `http://localhost:8000/docs` for API docs.

Backend:

1. Run `python -m pip install -r backend/requirements.txt`.
2. From `backend/`, run `python -m alembic -c alembic.ini upgrade head`.
3. From `backend/`, run `python -m uvicorn app.main:app --reload --port 8000`.

Frontend:

1. From `frontend/`, run `npm install`.
2. Run `npm run dev`.
