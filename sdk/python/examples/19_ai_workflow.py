"""
Example 19: AI Agent Workflow

Demonstrates AI/ML workloads with:
- Job dependencies for multi-step agent workflows
- Rate limiting for API cost control
- Progress tracking for long-running jobs
"""

import asyncio
from flashq import FlashQ, Worker


QUEUE_NAME = "ai-workflow"


# Simulated AI functions
async def parse_intent(prompt: str) -> dict:
    await asyncio.sleep(0.1)  # Simulate API latency
    return {
        "intent": "search_and_answer",
        "entities": ["flashQ", "job queue", "AI"],
    }


async def retrieve_context(query: str) -> list[str]:
    await asyncio.sleep(0.15)  # Simulate vector DB lookup
    return [
        "flashQ is a high-performance job queue built with Rust.",
        "It supports job dependencies for workflow orchestration.",
        "Rate limiting helps control API costs for LLM calls.",
    ]


async def generate_response(context: list[str], intent: str) -> str:
    await asyncio.sleep(0.2)  # Simulate LLM call
    return f"Based on the context about {intent}: {' '.join(context)}"


async def process_step(job):
    step = job.data.get("step")
    data = job.data

    if step == "parse":
        print(f"[Job {job.id}] Parsing intent...")
        return await parse_intent(data.get("prompt", ""))
    elif step == "retrieve":
        print(f"[Job {job.id}] Retrieving context...")
        return await retrieve_context(data.get("query", ""))
    elif step == "generate":
        print(f"[Job {job.id}] Generating response...")
        return await generate_response(
            data.get("context", []),
            data.get("intent", ""),
        )
    else:
        raise ValueError(f"Unknown step: {step}")


async def main():
    async with FlashQ() as client:
        await client.obliterate(QUEUE_NAME)

        # Set rate limit to control API costs
        await client.set_rate_limit(QUEUE_NAME, 10)  # 10 jobs/sec

        print("=== AI Agent Workflow Example ===\n")

        # Create worker
        worker = Worker(
            QUEUE_NAME,
            process_step,
            worker_options={"concurrency": 5, "auto_start": False},
        )

        worker.on(
            "completed",
            lambda job, result: print(
                f"[Job {job.id}] Completed: {str(result)[:100]}..."
            ),
        )
        worker.on("failed", lambda job, error: print(f"[Job {job.id}] Failed: {error}"))

        await worker.start()

        # Start the workflow
        user_prompt = "Tell me about flashQ and how it helps with AI workloads"
        print(f'User: "{user_prompt}"\n')

        # Step 1: Parse user intent
        parse_job_id = await client.push(QUEUE_NAME, {"step": "parse", "prompt": user_prompt})
        print(f"Created parse job: {parse_job_id}")

        # Wait for parse to complete
        parse_result = await client.finished(parse_job_id, timeout=10000)
        print(f"Parse result: {parse_result}\n")

        # Step 2: Retrieve context
        retrieve_job_id = await client.push(
            QUEUE_NAME,
            {
                "step": "retrieve",
                "query": " ".join(parse_result.get("entities", [])) if parse_result else user_prompt,
            },
        )
        print(f"Created retrieve job: {retrieve_job_id}")

        retrieve_result = await client.finished(retrieve_job_id, timeout=10000)
        print(f"Retrieve result: {len(retrieve_result) if retrieve_result else 0} chunks\n")

        # Step 3: Generate response
        generate_job_id = await client.push(
            QUEUE_NAME,
            {
                "step": "generate",
                "context": retrieve_result,
                "intent": parse_result.get("intent") if parse_result else "unknown",
            },
        )
        print(f"Created generate job: {generate_job_id}")

        final_result = await client.finished(generate_job_id, timeout=10000)
        print(f"\n=== Final Response ===")
        print(final_result)

        await worker.stop()
        await client.obliterate(QUEUE_NAME)
        print("\n=== Workflow Complete ===")


if __name__ == "__main__":
    asyncio.run(main())
