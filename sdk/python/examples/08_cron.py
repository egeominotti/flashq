"""
Example 08: Cron Jobs

Demonstrates scheduled/recurring jobs.
"""

import asyncio
from flashq import FlashQ


async def main():
    async with FlashQ() as client:
        # Add a cron job that runs every minute
        await client.add_cron(
            name="hourly-report",
            queue="reports",
            schedule="0 * * * * *",  # Every minute (for demo)
            data={"type": "hourly"},
        )
        print("Added cron job: hourly-report")

        # Add another cron job
        await client.add_cron(
            name="daily-cleanup",
            queue="maintenance",
            schedule="0 0 0 * * *",  # Daily at midnight
            data={"type": "cleanup"},
        )
        print("Added cron job: daily-cleanup")

        # List all cron jobs
        crons = await client.list_crons()
        print(f"\nActive cron jobs ({len(crons)}):")
        for cron in crons:
            print(f"  - {cron.name}: {cron.schedule} -> {cron.queue}")

        # Wait for a cron job to trigger
        print("\nWaiting for cron job to trigger...")
        job = await client.pull("reports", timeout=65000)
        if job:
            print(f"Received cron job: {job.data}")
            await client.ack(job.id)

        # Clean up
        await client.delete_cron("hourly-report")
        await client.delete_cron("daily-cleanup")
        print("\nCron jobs deleted")


if __name__ == "__main__":
    asyncio.run(main())
