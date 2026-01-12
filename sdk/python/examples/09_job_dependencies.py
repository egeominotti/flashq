#!/usr/bin/env python3
"""
FlashQ Python SDK - Job Dependencies Example

Demonstrates job dependencies and workflow orchestration.

Usage:
    python examples/09_job_dependencies.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ, PushOptions, JobState


async def main():
    print("FlashQ Job Dependencies Example")
    print("=" * 50)

    async with FlashQ() as client:
        # 1. Simple Dependency Chain
        print("\n[1. Simple Dependency Chain]")
        print("  A -> B -> C (each waits for previous)")

        job_a = await client.push("deps-demo", {"step": "A", "action": "fetch_data"})
        print(f"  Created job A: {job_a.id}")

        job_b = await client.push("deps-demo", {"step": "B", "action": "transform"}, PushOptions(
            depends_on=[job_a.id]
        ))
        print(f"  Created job B: {job_b.id} (depends on A)")

        job_c = await client.push("deps-demo", {"step": "C", "action": "save"}, PushOptions(
            depends_on=[job_b.id]
        ))
        print(f"  Created job C: {job_c.id} (depends on B)")

        # Check states
        for job, name in [(job_a, "A"), (job_b, "B"), (job_c, "C")]:
            state = await client.get_state(job.id)
            print(f"  Job {name} state: {state}")

        # Process in order
        for name in ["A", "B", "C"]:
            job = await client.pull("deps-demo")
            print(f"  Processing job {name}: {job.data['action']}")
            await client.ack(job.id)
            await asyncio.sleep(0.1)

        # 2. Fan-Out Pattern
        print("\n[2. Fan-Out Pattern]")
        print("  Master -> [Worker1, Worker2, Worker3]")

        master = await client.push("fanout-demo", {"task": "distribute"})
        print(f"  Created master job: {master.id}")

        workers = []
        for i in range(3):
            worker = await client.push("fanout-demo", {"task": f"worker_{i}"}, PushOptions(
                depends_on=[master.id]
            ))
            workers.append(worker)
            print(f"  Created worker {i}: {worker.id}")

        # Complete master
        pulled = await client.pull("fanout-demo")
        await client.ack(pulled.id)
        print("  Master completed -> workers unlocked")

        # Workers can now run in parallel
        for _ in range(3):
            job = await client.pull("fanout-demo")
            await client.ack(job.id)
            print(f"  Worker completed: {job.data['task']}")

        # 3. Fan-In Pattern
        print("\n[3. Fan-In Pattern]")
        print("  [Task1, Task2, Task3] -> Aggregator")

        tasks = []
        for i in range(3):
            task = await client.push("fanin-demo", {"task": f"compute_{i}", "value": i * 10})
            tasks.append(task)
            print(f"  Created task {i}: {task.id}")

        aggregator = await client.push("fanin-demo", {"task": "aggregate"}, PushOptions(
            depends_on=[t.id for t in tasks]
        ))
        print(f"  Created aggregator: {aggregator.id} (depends on all tasks)")

        state = await client.get_state(aggregator.id)
        print(f"  Aggregator state: {state}")

        # Complete all tasks
        for i in range(3):
            job = await client.pull("fanin-demo")
            await client.ack(job.id, result={"computed": job.data.get("value", 0) * 2})
            print(f"  Completed: {job.data['task']}")

        # Now aggregator is ready
        await asyncio.sleep(0.2)
        agg = await client.pull("fanin-demo")
        print(f"  Aggregator now ready: {agg.data['task']}")
        await client.ack(agg.id)

        # 4. Diamond Pattern
        print("\n[4. Diamond Pattern]")
        print("      A")
        print("     / \\")
        print("    B   C")
        print("     \\ /")
        print("      D")

        a = await client.push("diamond-demo", {"step": "A"})
        b = await client.push("diamond-demo", {"step": "B"}, PushOptions(depends_on=[a.id]))
        c = await client.push("diamond-demo", {"step": "C"}, PushOptions(depends_on=[a.id]))
        d = await client.push("diamond-demo", {"step": "D"}, PushOptions(depends_on=[b.id, c.id]))

        print(f"  Jobs: A={a.id}, B={b.id}, C={c.id}, D={d.id}")

        # Process A
        job = await client.pull("diamond-demo")
        print(f"  Processing {job.data['step']}")
        await client.ack(job.id)

        # B and C can run in parallel
        for _ in range(2):
            job = await client.pull("diamond-demo")
            print(f"  Processing {job.data['step']}")
            await client.ack(job.id)

        # D runs last
        await asyncio.sleep(0.1)
        job = await client.pull("diamond-demo")
        print(f"  Processing {job.data['step']}")
        await client.ack(job.id)

        # 5. Data Pipeline Example
        print("\n[5. Data Pipeline]")

        # Stage 1: Extract
        extract = await client.push("pipeline", {
            "stage": "extract",
            "source": "database",
            "table": "users"
        })

        # Stage 2: Transform (depends on extract)
        transform = await client.push("pipeline", {
            "stage": "transform",
            "operations": ["filter", "map", "clean"]
        }, PushOptions(depends_on=[extract.id]))

        # Stage 3: Load (depends on transform)
        load = await client.push("pipeline", {
            "stage": "load",
            "destination": "data_warehouse"
        }, PushOptions(depends_on=[transform.id]))

        print(f"  Pipeline: extract({extract.id}) -> transform({transform.id}) -> load({load.id})")

        # Process pipeline
        for stage in ["extract", "transform", "load"]:
            job = await client.pull("pipeline")
            print(f"  Running {job.data['stage']}...")
            await client.ack(job.id)

        print("  Pipeline complete!")

        # Cleanup
        print("\n[Cleanup]")
        for queue in ["deps-demo", "fanout-demo", "fanin-demo", "diamond-demo", "pipeline"]:
            while True:
                try:
                    job = await asyncio.wait_for(client.pull(queue), timeout=0.2)
                    await client.ack(job.id)
                except asyncio.TimeoutError:
                    break

    print("\nJob dependencies example complete!")


if __name__ == "__main__":
    asyncio.run(main())
