Repository layout summary:

- backend/: FastAPI backend and LangGraph node implementations (scaffold)
- frontend/: Next.js App Router + TailwindCSS scaffold
- docker-compose.yml for local orchestration (Postgres, Chroma, backend, frontend)

Next steps:
- Implement SQLAlchemy models and Alembic migrations
- Implement LangGraph orchestration graphs using `langgraph` SDK
- Add LLM connectors (OpenAI) and embedding ingestion to Chroma
- Build interactive frontend components and MathJax/Three.js integrations
