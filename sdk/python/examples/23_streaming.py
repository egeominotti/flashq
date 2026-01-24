"""
Example 23: Live Job Streaming

Demonstrates streaming partial results from jobs in real-time.
Use case: LLM token streaming, chunked file processing, progress data.

Run: python examples/23_streaming.py
"""

import asyncio
from flashq import FlashQ, Worker


async def main():
    client = FlashQ()
    await client.connect()

    print("=== Live Job Streaming Example ===\n")

    # Define streaming worker
    async def process_llm(job):
        prompt = job.data.get("prompt", "")
        print(f"[Worker] Processing prompt: \"{prompt}\"")

        # Simulate token-by-token generation
        tokens = ["Hello", ",", " I", " am", " an", " AI", " assistant", "."]

        for i, token in enumerate(tokens):
            # Send partial result (token)
            await client.partial(job.id, {"token": token}, index=i)
            print(f"[Worker] Sent token {i}: \"{token}\"")

            # Simulate generation delay
            await asyncio.sleep(0.1)

        return {"complete": True, "total_tokens": len(tokens)}

    # Create worker
    worker = Worker(["llm"], process_llm, client=client, auto_start=False)

    # Event handlers
    @worker.on("completed")
    def on_completed(job, result):
        print(f"\n[Event] Job {job.id} completed:", result)

    # Start worker
    worker.start()

    # Push a job
    job_id = await client.push("llm", {"prompt": "Say hello"})
    print(f"[Client] Pushed job {job_id}")
    print("[Client] Streaming tokens...\n")

    # Wait for completion
    await asyncio.sleep(2)

    # Get final result
    result = await client.get_result(job_id)
    print(f"\n[Client] Final result: {result}")

    # Cleanup
    await worker.close()
    await client.close()

    print("\n=== Streaming Complete ===")
    print("\nTo consume streaming events, use SSE:")
    print("  curl -N http://localhost:6790/events/job/{id}?events=partial")


if __name__ == "__main__":
    asyncio.run(main())
