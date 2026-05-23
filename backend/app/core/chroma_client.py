from typing import List, Dict, Any
import os
import asyncio

try:
    import chromadb
    from chromadb.config import Settings
except Exception:
    chromadb = None

from app.ai.openai_client import create_embedding


class ChromaClient:
    def __init__(self):
        self.client = None
        if chromadb:
            host = os.getenv("CHROMA_API_HOST", "http://chroma:8000").replace("http://", "").replace("https://", "")
            if ":" in host:
                host, port = host.rsplit(":", 1)
            else:
                port = "8000"
            self.client = chromadb.Client(
                Settings(
                    chroma_api_impl="chromadb.api.fastapi.FastAPI",
                    chroma_server_host=host,
                    chroma_server_http_port=port,
                )
            )

    async def add_documents(self, collection_name: str, docs: List[str], metadatas: List[Dict[str, Any]], ids: List[str] | None = None):
        if not self.client:
            return None
        embeddings = await create_embedding(docs)

        def _add():
            coll = None
            try:
                coll = self.client.get_collection(collection_name)
            except Exception:
                coll = self.client.create_collection(collection_name)
            coll.add(documents=docs, metadatas=metadatas, ids=ids, embeddings=embeddings)
            return True

        return await asyncio.to_thread(_add)

    async def semantic_search(self, collection_name: str, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        if not self.client:
            return []

        query_emb = await create_embedding([query])

        def _query():
            coll = self.client.get_collection(collection_name)
            res = coll.query(query_embeddings=query_emb, n_results=top_k)
            return res

        return await asyncio.to_thread(_query)

