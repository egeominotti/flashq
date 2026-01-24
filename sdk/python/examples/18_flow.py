"""
Example 18: Job Flow - Parent/Child Dependencies

Demonstrates workflow with job dependencies.
"""

import asyncio
from flashq import FlashQ, Worker


async def main():
    async with FlashQ() as client:
        await client.obliterate("sections")
        await client.obliterate("report")

        async def process_section(job):
            print(f"Processing section: {job.data['section']}")
            await asyncio.sleep(0.3)
            return {"section": job.data["section"], "done": True}

        async def process_report(job):
            print(f"\nGenerating report: {job.data['type']}")
            return {"report": "complete"}

        # Child worker
        child_worker = Worker(
            "sections",
            process_section,
            worker_options={"concurrency": 3, "auto_start": False},
        )

        # Parent worker (runs after all children)
        parent_worker = Worker(
            "report",
            process_report,
            worker_options={"concurrency": 1, "auto_start": False},
        )

        await child_worker.start()
        await parent_worker.start()

        # Push flow: parent waits for children
        flow = await client.push_flow(
            "report",
            {"type": "monthly"},
            [
                {"queue": "sections", "data": {"section": "sales"}},
                {"queue": "sections", "data": {"section": "marketing"}},
                {"queue": "sections", "data": {"section": "operations"}},
            ],
        )

        print(f"Parent: {flow['parent_id']}")
        print(f"Children: {', '.join(map(str, flow['children_ids']))}\n")

        await asyncio.sleep(3)

        await child_worker.stop()
        await parent_worker.stop()


if __name__ == "__main__":
    asyncio.run(main())
