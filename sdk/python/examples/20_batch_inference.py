"""
Example 20: Batch Inference

Demonstrates high-throughput AI inference:
- Bulk job submission for batch processing
- Concurrency control for GPU utilization
- Worker event-based result collection
"""

import asyncio
import random
import time
from flashq import FlashQ, Worker


QUEUE_NAME = "batch-inference"
BATCH_SIZE = 20
CONCURRENCY = 3


async def generate_embedding(text: str) -> list[float]:
    """Simulated embedding function."""
    await asyncio.sleep(0.02)  # 20ms inference
    return [random.random() * 2 - 1 for _ in range(1536)]


async def main():
    async with FlashQ() as client:
        await client.obliterate(QUEUE_NAME)

        print("=== Batch Inference Example ===\n")
        print(f"Batch size: {BATCH_SIZE} documents")
        print(f"Concurrency: {CONCURRENCY} parallel jobs\n")

        # Track results
        results: dict[int, list[float]] = {}
        completed = 0

        async def process_embedding(job):
            text = job.data.get("text", "")
            index = job.data.get("index", 0)
            embedding = await generate_embedding(text)
            return {"index": index, "embedding": embedding}

        # Create worker
        worker = Worker(
            QUEUE_NAME,
            process_embedding,
            worker_options={"concurrency": CONCURRENCY, "auto_start": False},
        )

        def on_completed(job, result):
            nonlocal completed
            results[result["index"]] = result["embedding"]
            completed += 1
            if completed % 10 == 0:
                print(f"Progress: {completed}/{BATCH_SIZE}")

        worker.on("completed", on_completed)
        worker.on("failed", lambda job, error: print(f"Job failed: {error}"))

        await worker.start()
        await asyncio.sleep(0.3)

        # Generate documents
        documents = [
            {"text": f"Document {i}: Sample text for embedding.", "index": i}
            for i in range(BATCH_SIZE)
        ]

        print("Submitting batch...")
        start_time = time.time()

        # Submit all jobs
        result = await client.push_batch(
            QUEUE_NAME, [{"data": doc} for doc in documents]
        )

        print(f"Submitted {len(result.job_ids)} jobs\n")
        print("Processing...")

        # Wait for all jobs
        while completed < BATCH_SIZE:
            await asyncio.sleep(0.1)

        total_time = (time.time() - start_time) * 1000
        throughput = BATCH_SIZE / (total_time / 1000)

        print(f"\n=== Results ===")
        print(f"Total time: {total_time:.0f}ms")
        print(f"Throughput: {throughput:.1f} embeddings/sec")
        print(f"Results collected: {len(results)}")
        print(f"Sample embedding dims: {len(results.get(0, []))}")
        print(f"All results valid: {'YES' if len(results) == BATCH_SIZE else 'NO'}")

        await worker.stop()
        await client.obliterate(QUEUE_NAME)

        print("\n=== Batch Complete ===")


if __name__ == "__main__":
    asyncio.run(main())
