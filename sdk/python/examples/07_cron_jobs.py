#!/usr/bin/env python3
"""
FlashQ Python SDK - Cron Jobs Example

Demonstrates scheduled/recurring jobs with cron expressions.

Usage:
    python examples/07_cron_jobs.py

Requirements:
    - FlashQ server running on localhost:6789
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from flashq import FlashQ, CronOptions


async def main():
    print("FlashQ Cron Jobs Example")
    print("=" * 50)

    async with FlashQ() as client:
        # 1. Add Cron Job - Every Minute
        print("\n[1. Every Minute Cron Job]")

        await client.add_cron("minute-task", CronOptions(
            queue="cron-demo",
            data={"task": "check_health", "interval": "1min"},
            schedule="0 * * * * *",  # sec min hour day month weekday
            priority=5
        ))
        print("  Added 'minute-task': runs every minute")

        # 2. Add Cron Job - Every Hour
        print("\n[2. Hourly Cron Job]")

        await client.add_cron("hourly-cleanup", CronOptions(
            queue="maintenance",
            data={"task": "cleanup_temp_files"},
            schedule="0 0 * * * *",  # At minute 0 of every hour
            priority=10
        ))
        print("  Added 'hourly-cleanup': runs every hour")

        # 3. Add Cron Job - Daily at Midnight
        print("\n[3. Daily Cron Job]")

        await client.add_cron("daily-report", CronOptions(
            queue="reports",
            data={"task": "generate_daily_summary", "email": "admin@example.com"},
            schedule="0 0 0 * * *",  # At 00:00:00 every day
            priority=20
        ))
        print("  Added 'daily-report': runs daily at midnight")

        # 4. Add Cron Job - Weekdays at 9 AM
        print("\n[4. Weekday Morning Cron Job]")

        await client.add_cron("weekday-standup", CronOptions(
            queue="notifications",
            data={"task": "send_standup_reminder", "channel": "#team"},
            schedule="0 0 9 * * 1-5",  # Mon-Fri at 9:00 AM
            priority=15
        ))
        print("  Added 'weekday-standup': runs Mon-Fri at 9 AM")

        # 5. Add Cron Job - Every 5 Minutes
        print("\n[5. Every 5 Minutes Cron Job]")

        await client.add_cron("metrics-collector", CronOptions(
            queue="monitoring",
            data={"task": "collect_metrics", "sources": ["cpu", "memory", "disk"]},
            schedule="0 */5 * * * *",  # Every 5 minutes
            priority=5
        ))
        print("  Added 'metrics-collector': runs every 5 minutes")

        # 6. List All Cron Jobs
        print("\n[6. List All Cron Jobs]")

        crons = await client.list_crons()
        print(f"  Found {len(crons)} cron jobs:")
        for cron in crons:
            print(f"  - {cron.name}")
            print(f"    Queue: {cron.queue}")
            print(f"    Schedule: {cron.schedule}")
            print(f"    Priority: {cron.priority}")
            print(f"    Next run: {cron.next_run}")

        # 7. Update Cron Job (delete and re-add)
        print("\n[7. Update Cron Job]")

        # Delete old version
        await client.delete_cron("minute-task")
        print("  Deleted 'minute-task'")

        # Add updated version
        await client.add_cron("minute-task", CronOptions(
            queue="cron-demo",
            data={"task": "check_health", "interval": "1min", "version": 2},
            schedule="30 * * * * *",  # At second 30 of every minute
            priority=8
        ))
        print("  Re-added 'minute-task' with new schedule")

        # 8. Common Cron Patterns
        print("\n[8. Common Cron Patterns Reference]")
        patterns = [
            ("0 * * * * *", "Every minute"),
            ("0 0 * * * *", "Every hour"),
            ("0 0 0 * * *", "Every day at midnight"),
            ("0 0 12 * * *", "Every day at noon"),
            ("0 0 0 * * 0", "Every Sunday at midnight"),
            ("0 0 0 1 * *", "First day of every month"),
            ("0 */15 * * * *", "Every 15 minutes"),
            ("0 0 9-17 * * 1-5", "Every hour 9AM-5PM, Mon-Fri"),
        ]
        for schedule, description in patterns:
            print(f"  '{schedule}' = {description}")

        # Cleanup - delete all test cron jobs
        print("\n[Cleanup]")
        test_crons = ["minute-task", "hourly-cleanup", "daily-report",
                      "weekday-standup", "metrics-collector"]
        for name in test_crons:
            try:
                await client.delete_cron(name)
                print(f"  Deleted '{name}'")
            except Exception:
                pass

        # Verify cleanup
        remaining = await client.list_crons()
        remaining_test = [c for c in remaining if c.name in test_crons]
        if not remaining_test:
            print("  All test cron jobs cleaned up")

    print("\nCron jobs example complete!")


if __name__ == "__main__":
    asyncio.run(main())
