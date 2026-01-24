"""
Example 21: RAG (Retrieval Augmented Generation) Pipeline

Complete RAG pipeline with:
- Document chunking and embedding
- Vector similarity search
- LLM response generation
"""

import asyncio
import math
from flashq import FlashQ, Worker


EMBED_QUEUE = "rag-embed"
SEARCH_QUEUE = "rag-search"
GENERATE_QUEUE = "rag-generate"

# Simulated vector database
vector_db: dict[str, dict] = {}


async def embed(text: str) -> list[float]:
    """Simulated embedding model."""
    await asyncio.sleep(0.01)
    hash_val = sum(ord(c) for c in text)
    return [math.sin(hash_val + i) * 0.5 for i in range(384)]


async def vector_search(query_embed: list[float], top_k: int) -> list[str]:
    """Simulated vector search."""
    await asyncio.sleep(0.005)
    keys = list(vector_db.keys())
    return [vector_db[k]["text"] for k in keys[:min(top_k, len(keys))]]


async def generate_response(context: list[str], query: str) -> str:
    """Simulated LLM generation."""
    await asyncio.sleep(0.05)
    return f'Based on {len(context)} retrieved documents about "{query[:30]}...", the answer is: [Generated response here]'


async def main():
    async with FlashQ() as client:
        await client.obliterate(EMBED_QUEUE)
        await client.obliterate(SEARCH_QUEUE)
        await client.obliterate(GENERATE_QUEUE)

        print("=== RAG Pipeline Example ===\n")

        # Step 1: Document Embedding Worker
        async def embed_doc(job):
            doc_id = job.data.get("doc_id")
            text = job.data.get("text")
            embedding = await embed(text)
            vector_db[doc_id] = {"text": text, "embedding": embedding}
            return {"doc_id": doc_id, "dimensions": len(embedding)}

        embed_worker = Worker(
            EMBED_QUEUE,
            embed_doc,
            worker_options={"concurrency": 5, "auto_start": False},
        )

        # Step 2: Search Worker
        async def search_docs(job):
            query = job.data.get("query")
            top_k = job.data.get("top_k", 3)
            query_embed = await embed(query)
            results = await vector_search(query_embed, top_k)
            return {"query": query, "results": results}

        search_worker = Worker(
            SEARCH_QUEUE,
            search_docs,
            worker_options={"concurrency": 2, "auto_start": False},
        )

        # Step 3: Generation Worker
        async def generate_doc(job):
            query = job.data.get("query")
            context = job.data.get("context", [])
            response = await generate_response(context, query)
            return {"response": response}

        generate_worker = Worker(
            GENERATE_QUEUE,
            generate_doc,
            worker_options={"concurrency": 1, "auto_start": False},
        )

        await embed_worker.start()
        await search_worker.start()
        await generate_worker.start()
        await asyncio.sleep(0.5)

        # Index some documents
        print("Phase 1: Indexing documents...")
        documents = [
            {"doc_id": "doc1", "text": "FlashQ is a high-performance job queue built in Rust."},
            {"doc_id": "doc2", "text": "It supports priorities, delays, and rate limiting."},
            {"doc_id": "doc3", "text": "Workers can process jobs concurrently with configurable limits."},
            {"doc_id": "doc4", "text": "The queue persists to SQLite for durability."},
            {"doc_id": "doc5", "text": "It is compatible with BullMQ APIs for easy migration."},
        ]

        embed_jobs = []
        for doc in documents:
            job_id = await client.push(EMBED_QUEUE, doc)
            embed_jobs.append(job_id)

        # Wait for embeddings
        for job_id in embed_jobs:
            await client.finished(job_id)
        print(f"Indexed {len(documents)} documents\n")

        # Process a query
        print("Phase 2: Processing query...")
        user_query = "How does FlashQ handle job priorities?"
        print(f'Query: "{user_query}"\n')

        # Search for relevant documents
        search_job_id = await client.push(SEARCH_QUEUE, {"query": user_query, "top_k": 3})
        search_result = await client.finished(search_job_id)

        print("Retrieved context:")
        for i, r in enumerate(search_result.get("results", [])):
            print(f"  {i + 1}. {r}")

        # Generate response
        print("\nPhase 3: Generating response...")
        gen_job_id = await client.push(
            GENERATE_QUEUE, {"query": user_query, "context": search_result.get("results", [])}
        )
        gen_result = await client.finished(gen_job_id)

        print("\n=== Final Response ===")
        print(gen_result.get("response"))

        # Cleanup
        await embed_worker.stop()
        await search_worker.stop()
        await generate_worker.stop()
        await client.obliterate(EMBED_QUEUE)
        await client.obliterate(SEARCH_QUEUE)
        await client.obliterate(GENERATE_QUEUE)

        print("\n=== Pipeline Complete ===")


if __name__ == "__main__":
    asyncio.run(main())
