Repository layout summary:

- backend/: FastAPI backend and LangGraph node implementations (scaffold)
- frontend/: Next.js App Router + TailwindCSS scaffold
- Structured persistence is Neon PostgreSQL via `DATABASE_URL`.
- Vector persistence is Chroma Cloud via `CHROMA_TENANT`, `CHROMA_DATABASE`, and `CHROMA_API_KEY`.
- AI inference is routed through AWS Bedrock:
  - Claude 3.7 Sonnet for pedagogy, lesson planning, and content generation
  - Claude 3 Haiku for fast interactions
  - Amazon Titan Text Embeddings for vector memory

Next steps:
- Implement SQLAlchemy models and Alembic migrations
- Implement LangGraph orchestration graphs using `langgraph` SDK
- Harden AWS Bedrock model access, retry handling, and embedding ingestion to Chroma Cloud
- Build interactive frontend components and MathJax/Three.js integrations
