# EvolvED — Adaptive Educational Intelligence Platform

This repository contains the EvolvED production-grade adaptive learning system scaffold.

Services:
- backend: FastAPI AI orchestration, LangGraph agents, PostgreSQL, ChromaDB
- frontend: Next.js (App Router), TypeScript, TailwindCSS

Quick start (development):

1. Copy `.env.example` to `.env` and fill values (OpenAI key, etc.).
2. Run `docker-compose up --build` from repository root.
3. Open `http://localhost:3000` for the frontend and `http://localhost:8000/docs` for API docs.
