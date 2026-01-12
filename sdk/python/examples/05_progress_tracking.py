#!/usr/bin/env python3
"""
FlashQ Python SDK - Progress Tracking Example

Demonstrates job progress updates and monitoring.

Usage:
    python examples/05_progress_tracking.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ


async def main():
    print("FlashQ Progress Tracking Example")
    print("=" * 50)

    async with FlashQ() as client:
        # 1. Basic Progress Updates
        print("\n[1. Basic Progress Updates]")

        job = await client.push("progress-demo", {
            "task": "process_large_file",
            "filename": "data.csv",
            "total_rows": 10000
        })
        print(f"  Created job {job.id}")

        # Pull the job (simulating a worker)
        pulled = await client.pull("progress-demo")

        # Simulate processing with progress updates
        steps = [
            (0, "Starting..."),
            (25, "Reading file..."),
            (50, "Processing rows..."),
            (75, "Validating data..."),
            (100, "Complete!")
        ]

        for progress, message in steps:
            await client.progress(pulled.id, progress, message)

            # Check progress
            prog = await client.get_progress(pulled.id)
            print(f"  Progress: {prog.progress}% - {prog.message}")

            await asyncio.sleep(0.2)  # Simulate work

        await client.ack(pulled.id)
        print("  Job completed!")

        # 2. Monitor Progress from Another Client
        print("\n[2. Progress Monitoring]")

        # Push a job
        job = await client.push("monitor-demo", {"task": "long_running"})
        print(f"  Started job {job.id}")

        # Start worker task
        async def worker():
            pulled = await client.pull("monitor-demo")
            for i in range(0, 101, 10):
                await client.progress(pulled.id, i, f"Step {i//10}/10")
                await asyncio.sleep(0.1)
            await client.ack(pulled.id)

        # Start monitor task
        async def monitor(job_id):
            last_progress = -1
            while True:
                prog = await client.get_progress(job_id)
                if prog.progress != last_progress:
                    print(f"  Monitor: {prog.progress}% - {prog.message or 'N/A'}")
                    last_progress = prog.progress
                if prog.progress >= 100:
                    break
                await asyncio.sleep(0.05)

        # Run both concurrently
        await asyncio.gather(
            worker(),
            monitor(job.id)
        )

        # 3. Progress with Detailed Status
        print("\n[3. Detailed Progress Status]")

        job = await client.push("detailed-demo", {
            "task": "data_pipeline",
            "stages": ["extract", "transform", "load"]
        })

        pulled = await client.pull("detailed-demo")

        stages = [
            (10, "Extracting: Connecting to source..."),
            (20, "Extracting: Fetching records (1000/5000)..."),
            (30, "Extracting: Fetching records (3000/5000)..."),
            (40, "Extracting: Complete (5000 records)"),
            (50, "Transforming: Applying schema..."),
            (60, "Transforming: Validating types..."),
            (70, "Transforming: Complete"),
            (80, "Loading: Connecting to destination..."),
            (90, "Loading: Inserting records..."),
            (100, "Pipeline complete: 5000 records processed"),
        ]

        for progress, message in stages:
            await client.progress(pulled.id, progress, message)
            prog = await client.get_progress(pulled.id)
            print(f"  [{prog.progress:3d}%] {prog.message}")
            await asyncio.sleep(0.1)

        await client.ack(pulled.id, result={"records_processed": 5000})

    print("\nProgress tracking example complete!")


if __name__ == "__main__":
    asyncio.run(main())
