"""
Ingest initial curriculum into Chroma using OpenAI embeddings.

Usage:
    python -m backend.scripts.ingest_curriculum

Environment:
  - OPENAI_API_KEY must be set
  - CHROMA_API_HOST should point to running Chroma server (default: http://chroma:8000)

This script reads `backend/data/initial_curriculum.json` and stores entries
in the Chroma collection named `curriculum`.
"""
import asyncio
import json
import os
from pathlib import Path

from app.core.chroma_client import ChromaClient


CURRICULUM_PATH = Path(__file__).resolve().parents[1] / "data" / "initial_curriculum.json"


async def ingest(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Curriculum file not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        items = json.load(f)

    docs = [it.get("content") for it in items]
    metas = [{"id": it.get("id"), "topic": it.get("topic"), "concept": it.get("concept")} for it in items]
    ids = [it.get("id") for it in items]

    cc = ChromaClient()
    print(f"Ingesting {len(docs)} curriculum items into Chroma collection 'curriculum'...")
    res = await cc.add_documents("curriculum", docs, metas, ids=ids)
    print("Ingest complete.")
    return res


def main():
    asyncio.run(ingest(CURRICULUM_PATH))


if __name__ == "__main__":
    main()
