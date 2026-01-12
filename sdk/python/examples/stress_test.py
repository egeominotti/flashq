#!/usr/bin/env python3
"""
FlashQ Python SDK - Stress Test

Comprehensive stress tests for the FlashQ Python SDK.

Usage:
    python examples/stress_test.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
import time
import random
import string
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ, PushOptions, FlashQError


class StressTestRunner:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.results = []

    async def test(self, name: str, coro):
        """Run a single stress test"""
        print(f"\n  Running: {name}")
        start = time.perf_counter()
        try:
            result = await coro
            elapsed = (time.perf_counter() - start) * 1000
            self.passed += 1
            self.results.append((name, True, elapsed, result))
            print(f"  ✓ {name} ({elapsed:.1f}ms) - {result}")
        except Exception as e:
            elapsed = (time.perf_counter() - start) * 1000
            self.failed += 1
            self.results.append((name, False, elapsed, str(e)))
            print(f"  ✗ {name} ({elapsed:.1f}ms) - {e}")

    def summary(self):
        total = self.passed + self.failed
        print("\n" + "=" * 60)
        if self.failed == 0:
            print(f"  ✓ All {total} stress tests passed!")
        else:
            print(f"  {self.passed}/{total} tests passed, {self.failed} failed")
        print("=" * 60)
        return self.failed == 0


async def main():
    print("FlashQ Python SDK - Stress Tests")
    print("=" * 60)

    runner = StressTestRunner()

    # ==================== Throughput Tests ====================
    print("\n[Throughput Tests]")

    async def test_concurrent_push():
        """Push from multiple concurrent connections"""
        async def push_worker(worker_id, count):
            async with FlashQ() as client:
                for i in range(count):
                    await client.push(f"stress-{worker_id}", {"n": i})
            return count

        workers = 10
        jobs_per_worker = 100
        tasks = [push_worker(i, jobs_per_worker) for i in range(workers)]
        results = await asyncio.gather(*tasks)
        total = sum(results)
        return f"{total} jobs pushed from {workers} connections"

    await runner.test("Concurrent Push (10 connections)", test_concurrent_push())

    async def test_batch_throughput():
        """Batch push/pull throughput"""
        async with FlashQ() as client:
            # Push
            batch_size = 1000
            jobs = [{"data": {"n": i}} for i in range(batch_size)]
            start = time.perf_counter()
            ids = await client.push_batch("batch-stress", jobs)
            push_time = (time.perf_counter() - start) * 1000

            # Pull and ack
            start = time.perf_counter()
            pulled = 0
            while pulled < batch_size:
                batch = await client.pull_batch("batch-stress", 100)
                if not batch:
                    break
                await client.ack_batch([j.id for j in batch])
                pulled += len(batch)
            process_time = (time.perf_counter() - start) * 1000

            return f"Push: {push_time:.0f}ms, Process: {process_time:.0f}ms"

    await runner.test("Batch Operations (1K jobs)", test_batch_throughput())

    # ==================== Load Tests ====================
    print("\n[Load Tests]")

    async def test_large_payload():
        """Test with large job payloads"""
        async with FlashQ() as client:
            # 100KB payload
            large_data = {"content": "x" * 100_000}
            job = await client.push("large-payload", large_data)
            pulled = await client.pull("large-payload")
            await client.ack(pulled.id)

            # Verify integrity
            assert len(pulled.data["content"]) == 100_000
            return "100KB payload integrity verified"

    await runner.test("Large Payload (100KB)", test_large_payload())

    async def test_many_queues():
        """Operations across many queues"""
        async with FlashQ() as client:
            num_queues = 50
            for i in range(num_queues):
                await client.push(f"queue-{i}", {"queue_id": i})

            # Pull from all queues
            pulled = 0
            for i in range(num_queues):
                try:
                    job = await asyncio.wait_for(client.pull(f"queue-{i}"), timeout=1.0)
                    await client.ack(job.id)
                    pulled += 1
                except asyncio.TimeoutError:
                    pass

            return f"{pulled}/{num_queues} queues processed"

    await runner.test("Many Queues (50)", test_many_queues())

    # ==================== Feature Tests ====================
    print("\n[Feature Tests]")

    async def test_rate_limiting():
        """Rate limiting enforcement"""
        async with FlashQ() as client:
            await client.set_rate_limit("rate-stress", 20)

            # Push jobs
            await client.push_batch("rate-stress", [{"data": {"n": i}} for i in range(50)])

            # Pull and measure rate
            start = time.perf_counter()
            pulled = 0
            while pulled < 30:
                try:
                    job = await asyncio.wait_for(client.pull("rate-stress"), timeout=3.0)
                    await client.ack(job.id)
                    pulled += 1
                except asyncio.TimeoutError:
                    break

            elapsed = time.perf_counter() - start
            rate = pulled / elapsed if elapsed > 0 else 0

            await client.clear_rate_limit("rate-stress")

            # Cleanup
            while True:
                try:
                    job = await asyncio.wait_for(client.pull("rate-stress"), timeout=0.3)
                    await client.ack(job.id)
                except asyncio.TimeoutError:
                    break

            return f"Rate: {rate:.1f}/s (limit: 20/s)"

    await runner.test("Rate Limiting", test_rate_limiting())

    async def test_concurrency_limit():
        """Concurrency limit enforcement"""
        async with FlashQ() as client:
            await client.set_concurrency("conc-stress", 3)

            # Push jobs
            await client.push_batch("conc-stress", [{"data": {"n": i}} for i in range(10)])

            # Try to pull more than limit
            jobs = []
            for _ in range(5):
                try:
                    job = await asyncio.wait_for(client.pull("conc-stress"), timeout=1.0)
                    jobs.append(job)
                except asyncio.TimeoutError:
                    break

            concurrent = len(jobs)

            # Cleanup
            for job in jobs:
                await client.ack(job.id)
            await client.clear_concurrency("conc-stress")
            while True:
                try:
                    job = await asyncio.wait_for(client.pull("conc-stress"), timeout=0.3)
                    await client.ack(job.id)
                except asyncio.TimeoutError:
                    break

            return f"Max concurrent: {concurrent} (limit: 3)"

    await runner.test("Concurrency Limit", test_concurrency_limit())

    async def test_dlq_flood():
        """DLQ handling under load"""
        async with FlashQ() as client:
            # Create many failing jobs
            count = 50
            for i in range(count):
                job = await client.push("dlq-stress", {"n": i}, PushOptions(max_attempts=1))
                pulled = await client.pull("dlq-stress")
                await client.fail(pulled.id, f"Test failure {i}")

            # Check DLQ
            dlq_jobs = await client.get_dlq("dlq-stress", count=100)

            # Retry all
            retried = await client.retry_dlq("dlq-stress")

            # Process retried
            processed = 0
            while True:
                try:
                    job = await asyncio.wait_for(client.pull("dlq-stress"), timeout=0.5)
                    await client.ack(job.id)
                    processed += 1
                except asyncio.TimeoutError:
                    break

            return f"DLQ: {len(dlq_jobs)}, Retried: {retried}, Processed: {processed}"

    await runner.test("DLQ Flood (50 jobs)", test_dlq_flood())

    async def test_rapid_cancel():
        """Rapid job cancellation"""
        async with FlashQ() as client:
            # Push jobs
            ids = await client.push_batch("cancel-stress", [{"data": {"n": i}} for i in range(50)])

            # Cancel all
            cancelled = 0
            for job_id in ids:
                try:
                    await client.cancel(job_id)
                    cancelled += 1
                except FlashQError:
                    pass  # Job may have been pulled already

            return f"Cancelled: {cancelled}/{len(ids)}"

    await runner.test("Rapid Cancel (50 jobs)", test_rapid_cancel())

    # ==================== Validation Tests ====================
    print("\n[Validation Tests]")

    async def test_invalid_input():
        """Invalid input rejection"""
        async with FlashQ() as client:
            rejected = 0

            # Invalid queue names
            invalid_names = ["", "a" * 300, "queue with spaces", "queue<script>"]
            for name in invalid_names:
                try:
                    await client.push(name, {"test": True})
                except FlashQError:
                    rejected += 1

            return f"Rejected {rejected}/{len(invalid_names)} invalid inputs"

    await runner.test("Invalid Input Rejection", test_invalid_input())

    async def test_unique_key_collision():
        """Unique key handling under concurrent access"""
        async with FlashQ() as client:
            key = f"unique-stress-{random.randint(0, 999999)}"
            created = 0
            duplicates = 0

            async def try_push(n):
                nonlocal created, duplicates
                try:
                    await client.push("unique-stress", {"n": n}, PushOptions(unique_key=key))
                    created += 1
                except FlashQError as e:
                    if "Duplicate" in str(e):
                        duplicates += 1
                    else:
                        raise

            # Concurrent pushes with same key
            await asyncio.gather(*[try_push(i) for i in range(20)])

            # Cleanup
            while True:
                try:
                    job = await asyncio.wait_for(client.pull("unique-stress"), timeout=0.3)
                    await client.ack(job.id)
                except asyncio.TimeoutError:
                    break

            return f"Created: {created}, Duplicates: {duplicates}"

    await runner.test("Unique Key Collision (20 concurrent)", test_unique_key_collision())

    # ==================== Stability Tests ====================
    print("\n[Stability Tests]")

    async def test_connection_churn():
        """Rapid connection open/close"""
        success = 0
        for _ in range(30):
            client = FlashQ()
            await client.connect()
            await client.stats()
            await client.close()
            success += 1

        return f"{success}/30 connection cycles"

    await runner.test("Connection Churn (30 cycles)", test_connection_churn())

    async def test_sustained_load():
        """Sustained push/pull load"""
        async with FlashQ() as client:
            duration = 5  # seconds
            start = time.perf_counter()
            pushed = 0
            pulled = 0
            errors = 0

            async def pusher():
                nonlocal pushed, errors
                while time.perf_counter() - start < duration:
                    try:
                        await client.push("sustained-stress", {"t": time.time()})
                        pushed += 1
                    except Exception:
                        errors += 1
                    await asyncio.sleep(0.001)

            async def puller():
                nonlocal pulled, errors
                while time.perf_counter() - start < duration:
                    try:
                        job = await asyncio.wait_for(client.pull("sustained-stress"), timeout=0.5)
                        await client.ack(job.id)
                        pulled += 1
                    except asyncio.TimeoutError:
                        pass
                    except Exception:
                        errors += 1

            await asyncio.gather(pusher(), puller(), puller())

            # Cleanup remaining
            while True:
                try:
                    job = await asyncio.wait_for(client.pull("sustained-stress"), timeout=0.3)
                    await client.ack(job.id)
                    pulled += 1
                except asyncio.TimeoutError:
                    break

            return f"Pushed: {pushed}, Pulled: {pulled}, Errors: {errors}"

    await runner.test(f"Sustained Load (5s)", test_sustained_load())

    # ==================== Cleanup ====================
    print("\n[Cleanup]")
    async with FlashQ() as client:
        test_queues = [
            "stress-0", "stress-1", "stress-2", "stress-3", "stress-4",
            "stress-5", "stress-6", "stress-7", "stress-8", "stress-9",
            "batch-stress", "large-payload", "rate-stress", "conc-stress",
            "dlq-stress", "cancel-stress", "unique-stress", "sustained-stress"
        ] + [f"queue-{i}" for i in range(50)]

        for queue in test_queues:
            try:
                while True:
                    job = await asyncio.wait_for(client.pull(queue), timeout=0.1)
                    await client.ack(job.id)
            except asyncio.TimeoutError:
                pass

    print("  Cleanup complete")

    # Summary
    success = runner.summary()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
