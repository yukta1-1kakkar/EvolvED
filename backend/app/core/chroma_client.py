from typing import List, Dict, Any
import asyncio
import logging

try:
    import chromadb
except Exception:
    chromadb = None

from app.ai.factory import get_provider
from app.ai.router import ModelRouter
from app.core.config import settings


class ChromaClient:
    def __init__(self):
        self.client = None
        self.provider = get_provider()
        self.logger = logging.getLogger(__name__)

    def _ensure_client(self):
        if self.client:
            return self.client
        if not chromadb:
            raise RuntimeError("The chromadb package is not installed.")
        if not settings.chroma_api_key:
            return None

        kwargs = {"api_key": settings.chroma_api_key}
        if settings.chroma_tenant:
            kwargs["tenant"] = settings.chroma_tenant
        if settings.chroma_database:
            kwargs["database"] = settings.chroma_database
        self.client = chromadb.CloudClient(**kwargs)
        return self.client

    def _collection_name(self, namespace: str, collection_name: str) -> str:
        safe_namespace = namespace.strip().replace(" ", "_")
        safe_collection = collection_name.strip().replace(" ", "_")
        return f"{safe_namespace}_{safe_collection}" if safe_namespace else safe_collection

    def _get_or_create_collection(self, collection_name: str):
        client = self._ensure_client()
        if not client:
            raise RuntimeError("Chroma Cloud is not configured. Set CHROMA_TENANT, CHROMA_DATABASE, and CHROMA_API_KEY.")
        return client.get_or_create_collection(collection_name)

    async def add_documents(
        self,
        collection_name: str,
        docs: List[str],
        metadatas: List[Dict[str, Any]],
        ids: List[str] | None = None,
        namespace: str = "evolved",
    ):
        if not self._ensure_client():
            return None

        if ids:
            seen = set()
            unique_ids = []
            for uid in ids:
                if uid in seen:
                    self.logger.warning(f"Duplicate ID detected and removed: {uid}")
                    continue
                seen.add(uid)
                unique_ids.append(uid)
            ids = unique_ids

        embeddings = await self.provider.create_embedding(docs, model=ModelRouter.get_embedding_model())
        cloud_collection_name = self._collection_name(namespace, collection_name)
        document_ids = ids or [f"{cloud_collection_name}:{index}" for index in range(len(docs))]

        self.logger.info(f"Upserting {len(document_ids)} documents into {cloud_collection_name}")

        def _add():
            coll = self._get_or_create_collection(cloud_collection_name)
            coll.upsert(documents=docs, metadatas=metadatas, ids=document_ids, embeddings=embeddings)
            return True

        return await asyncio.to_thread(_add)

    async def semantic_search(self, collection_name: str, query: str, top_k: int = 5, namespace: str = "evolved") -> List[Dict[str, Any]]:
        if not self._ensure_client():
            return []

        query_emb = await self.provider.create_embedding([query], model=ModelRouter.get_embedding_model())
        cloud_collection_name = self._collection_name(namespace, collection_name)

        def _query():
            coll = self._get_or_create_collection(cloud_collection_name)
            res = coll.query(query_embeddings=query_emb, n_results=top_k)
            return res

        return await asyncio.to_thread(_query)
