import os
import uuid
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams, PointStruct
from sentence_transformers import SentenceTransformer
from ..utils.logger import logger


class MemorySystem:
    def __init__(self, persistence_path: str = "memory_store"):
        self.enabled = False
        self.client: Optional[QdrantClient] = None

        try:
            # Lazy load or just load. 'all-MiniLM-L6-v2' is ~80MB.
            logger.info("🧠 Loading Memory System (Embeddings)...")
            self.encoder = SentenceTransformer('all-MiniLM-L6-v2')
            self.enabled = True
        except Exception as e:
            logger.warning(f"Failed to load SentenceTransformer: {e}. Memory disabled.")
            return

        # Initialize Qdrant (local disk persistence)
        try:
            self.client = QdrantClient(path=persistence_path)
            self.collection_name = "agent_experiences"

            # Create collection if not exists
            collections = self.client.get_collections()
            if not any(c.name == self.collection_name for c in collections.collections):
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(size=384, distance=Distance.COSINE),
                )
        except Exception as e:
            logger.error(f"Failed to initialize Qdrant: {e}. Memory disabled.")
            self.enabled = False

    def add_experience(self, task: str, result: str, reflection: str, success: bool):
        """Saves an experience to the vector database."""
        if not self.enabled or not self.client:
            return

        # Embed the task and reflection combined for semantic search
        text_to_embed = f"Task: {task}. Reflection: {reflection}"
        vector = self.encoder.encode(text_to_embed).tolist()

        payload = {
            "task": task,
            "result": result,
            "reflection": reflection,
            "success": success,
            "timestamp": str(os.times())
        }

        # Use UUID for point ID
        point_id = str(uuid.uuid4())

        try:
            self.client.upsert(
                collection_name=self.collection_name,
                points=[PointStruct(id=point_id, vector=vector, payload=payload)]
            )
            logger.info("🧠 Experience saved to memory.")
        except Exception as e:
            logger.error(f"Failed to save memory: {e}")

    def retrieve_relevant(self, task: str, limit: int = 3) -> List[Dict[str, Any]]:
        """Retrieves similar past experiences."""
        if not self.enabled or not self.client:
            return []

        try:
            vector = self.encoder.encode(task).tolist()

            # Check which API version is available
            if hasattr(self.client, 'query_points'):
                # New Qdrant API (>= 1.10.0)
                results = self.client.query_points(
                    collection_name=self.collection_name,
                    query=vector,
                    limit=limit
                )
                # Convert to list of payloads
                return [r.payload for r in results.points if hasattr(r, 'score') and r.score > 0.4]
            elif hasattr(self.client, 'search'):
                # Old Qdrant API (< 1.10.0)
                results = self.client.search(
                    collection_name=self.collection_name,
                    query_vector=vector,
                    limit=limit
                )
                return [r.payload for r in results if hasattr(r, 'score') and r.score > 0.4]
            else:
                logger.warning("Qdrant client has no search method available")
                return []

        except Exception as e:
            logger.error(f"Failed to retrieve memory: {e}")
            return []
