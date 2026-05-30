# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Backend (Python/FastAPI)
- **Install Dependencies**: `pip install -r backend/requirements.txt`
- **Run Development Server**: `uvicorn app.main:app --reload --port 8000` (run from the `backend/` directory)
- **Database Migrations**: `alembic upgrade head` (run from the `backend/` directory)
- **Environment variables**: Configured in `.env` at the root of the repository, parsed by `backend/app/core/config.py`.

### Frontend (Next.js/TypeScript)
- **Install Dependencies**: `npm install` (run from the `frontend/` directory)
- **Run Development Server**: `npm run dev` (run from the `frontend/` directory)
- **Build Production**: `npm run build` (run from the `frontend/` directory)
- **Run Production Server**: `npm run start` (run from the `frontend/` directory)
- **Lint Code**: `npm run lint` (run from the `frontend/` directory)

---

## High-Level Architecture

EvolvED is an adaptive learning platform that generates personalized curriculum paths, interactive lesson structures, and real-time conceptual visualizations.

### Backend Architecture
- **Web API**: Built using FastAPI (`backend/app/main.py`), exposing endpoints for curriculum retrieval, lesson generation, assessment grading, speech synthesis (TTS), and progress analytics (`backend/app/api/routers.py`).
- **AI Service client**: Integrates with AWS Bedrock to call Claude (using version `anthropic.claude-3-7-sonnet-20250219-v1:0` by default) and Amazon Titan Text Embeddings, plus Amazon Polly for Text-to-Speech (`backend/app/ai/bedrock_client.py`).
- **Orchestration**: Orchestrates learner state analysis, pedagogical strategy, lesson planning, and content generation using an agentic LangGraph pattern (`backend/app/langgraph/graph.py` and `backend/app/core/langgraph_nodes.py`). Falls back to a sequential async runner if LangGraph SDK is absent.
- **Database / ORM**: Utilizes SQLAlchemy with `asyncio` and `asyncpg` connected to a PostgreSQL database (`backend/app/core/db.py`), with schema definitions in `backend/app/db/models.py` and Alembic migrations.
- **Vector Search / Memory**: Incorporates ChromaDB (`backend/app/core/chroma_client.py`) to persist and retrieve embeddings of generated lesson structures and assets.
- **Repository Pattern**: Implements an async repository class (`backend/app/core/repository.py`) to decouple data persistence logic from FastAPI route handlers.

### Frontend Architecture
- **Next.js & React**: Built using Next.js App Router (`frontend/app/`). Employs client-side fetching from the FastAPI backend (defaults to `http://localhost:8000`).
- **Interactive Visualizer**: Integrates a custom 2D math visualization canvas (`frontend/app/lesson/interactive.tsx`) that visualizes vectors and linear transformations (matrices, determinants, eigenvalues, eigenvectors).
- **Typesetting & Audio**: Integrates MathJax CDN for dynamic mathematical rendering and feeds Polly audio streams directly into standard browser audio elements for voice output.
