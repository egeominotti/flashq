/**
 * flashQ Playground API
 * Backend service using Elysia + Bun + flashQ SDK
 */

import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { FlashQ } from "flashq";

// Configuration
const FLASHQ_HOST = process.env.FLASHQ_HOST || "localhost";
const FLASHQ_PORT = parseInt(process.env.FLASHQ_PORT || "6789");
const API_PORT = parseInt(process.env.API_PORT || "3000");

// flashQ client instance
let client: FlashQ | null = null;
let isConnected = false;

/**
 * Initialize flashQ client connection
 */
async function initClient(): Promise<FlashQ> {
  if (client && isConnected) {
    return client;
  }

  client = new FlashQ({
    host: FLASHQ_HOST,
    port: FLASHQ_PORT,
    timeout: 5000,
  });

  await client.connect();
  isConnected = true;
  console.log(`Connected to flashQ at ${FLASHQ_HOST}:${FLASHQ_PORT}`);

  return client;
}

/**
 * Get connected client or throw error
 */
async function getClient(): Promise<FlashQ> {
  if (!client || !isConnected) {
    return await initClient();
  }
  return client;
}

// Initialize Elysia app
const app = new Elysia()
  .use(
    cors({
      origin: true, // Allow all origins for playground
      methods: ["GET", "POST", "OPTIONS"],
      credentials: true,
    })
  )
  .onError(({ error }) => {
    console.error("Error:", error);
    return {
      ok: false,
      error: error.message || "Internal server error",
    };
  })

  // Health check
  .get("/health", async () => {
    try {
      const c = await getClient();
      const stats = await c.stats();
      return {
        ok: true,
        data: {
          status: "healthy",
          flashq: "connected",
          stats,
        },
      };
    } catch (error: any) {
      isConnected = false;
      return {
        ok: false,
        error: error.message,
        data: {
          status: "unhealthy",
          flashq: "disconnected",
        },
      };
    }
  })

  // Push a job
  .post(
    "/push",
    async ({ body }) => {
      const c = await getClient();
      const job = await c.push(body.queue, body.data, {
        priority: body.priority || 0,
        delay: body.delay || 0,
      });
      return { ok: true, data: job };
    },
    {
      body: t.Object({
        queue: t.String(),
        data: t.Any(),
        priority: t.Optional(t.Number()),
        delay: t.Optional(t.Number()),
      }),
    }
  )

  // Push batch jobs
  .post(
    "/push-batch",
    async ({ body }) => {
      const c = await getClient();
      const jobs = body.jobs.map((j) => ({
        data: j.data,
        priority: j.priority || 0,
      }));
      const result = await c.pushBatch(body.queue, jobs);
      return { ok: true, data: { count: result.length, jobs: result } };
    },
    {
      body: t.Object({
        queue: t.String(),
        jobs: t.Array(
          t.Object({
            data: t.Any(),
            priority: t.Optional(t.Number()),
          })
        ),
      }),
    }
  )

  // Pull a job (simulates worker pulling)
  .post(
    "/pull",
    async ({ body }) => {
      const c = await getClient();
      const job = await c.pull(body.queue);
      if (!job) {
        return { ok: true, data: null, message: "No jobs available" };
      }
      return { ok: true, data: job };
    },
    {
      body: t.Object({
        queue: t.String(),
      }),
    }
  )

  // Acknowledge a job (mark as completed)
  .post(
    "/ack",
    async ({ body }) => {
      const c = await getClient();
      await c.ack(body.jobId, body.result);
      return { ok: true, data: { jobId: body.jobId, status: "completed" } };
    },
    {
      body: t.Object({
        jobId: t.Number(),
        result: t.Optional(t.Any()),
      }),
    }
  )

  // Fail a job
  .post(
    "/fail",
    async ({ body }) => {
      const c = await getClient();
      await c.fail(body.jobId, body.error);
      return { ok: true, data: { jobId: body.jobId, status: "failed" } };
    },
    {
      body: t.Object({
        jobId: t.Number(),
        error: t.Optional(t.String()),
      }),
    }
  )

  // Pull and Ack in one operation (simulates successful processing)
  .post(
    "/pull-and-ack",
    async ({ body }) => {
      const c = await getClient();

      // Pull a job
      const job = await c.pull(body.queue);
      if (!job) {
        return { ok: true, data: null, message: "No jobs available" };
      }

      // Simulate processing delay
      if (body.processingTime) {
        await new Promise((resolve) =>
          setTimeout(resolve, body.processingTime)
        );
      }

      // Acknowledge the job
      const result = {
        processed: true,
        processedAt: Date.now(),
        processingTime: body.processingTime || 0,
      };
      await c.ack(job.id, result);

      return {
        ok: true,
        data: {
          job,
          result,
          status: "completed",
        },
      };
    },
    {
      body: t.Object({
        queue: t.String(),
        processingTime: t.Optional(t.Number()),
      }),
    }
  )

  // Pull and Fail in one operation (simulates failed processing)
  .post(
    "/pull-and-fail",
    async ({ body }) => {
      const c = await getClient();

      // Pull a job
      const job = await c.pull(body.queue);
      if (!job) {
        return { ok: true, data: null, message: "No jobs available" };
      }

      // Fail the job
      await c.fail(job.id, body.error || "Simulated failure from playground");

      return {
        ok: true,
        data: {
          job,
          error: body.error || "Simulated failure from playground",
          status: "failed",
        },
      };
    },
    {
      body: t.Object({
        queue: t.String(),
        error: t.Optional(t.String()),
      }),
    }
  )

  // Get job details
  .get("/job/:id", async ({ params }) => {
    const c = await getClient();
    const job = await c.getJob(parseInt(params.id));
    if (!job) {
      return { ok: false, error: "Job not found" };
    }
    return { ok: true, data: job };
  })

  // Get job state
  .get("/job/:id/state", async ({ params }) => {
    const c = await getClient();
    const state = await c.getState(parseInt(params.id));
    return { ok: true, data: { jobId: parseInt(params.id), state } };
  })

  // Pause queue
  .post(
    "/queue/pause",
    async ({ body }) => {
      const c = await getClient();
      await c.pause(body.queue);
      return { ok: true, data: { queue: body.queue, status: "paused" } };
    },
    {
      body: t.Object({
        queue: t.String(),
      }),
    }
  )

  // Resume queue
  .post(
    "/queue/resume",
    async ({ body }) => {
      const c = await getClient();
      await c.resume(body.queue);
      return { ok: true, data: { queue: body.queue, status: "resumed" } };
    },
    {
      body: t.Object({
        queue: t.String(),
      }),
    }
  )

  // Drain queue
  .post(
    "/queue/drain",
    async ({ body }) => {
      const c = await getClient();
      const count = await c.drain(body.queue);
      return { ok: true, data: { queue: body.queue, drained: count } };
    },
    {
      body: t.Object({
        queue: t.String(),
      }),
    }
  )

  // Get stats
  .get("/stats", async () => {
    const c = await getClient();
    const stats = await c.stats();
    return { ok: true, data: stats };
  })

  // Get metrics
  .get("/metrics", async () => {
    const c = await getClient();
    const metrics = await c.metrics();
    return { ok: true, data: metrics };
  })

  // List queues
  .get("/queues", async () => {
    const c = await getClient();
    const queues = await c.listQueues();
    return { ok: true, data: queues };
  })

  // Get DLQ jobs
  .get("/queue/:name/dlq", async ({ params, query }) => {
    const c = await getClient();
    const count = parseInt((query as any).count || "10");
    const jobs = await c.getDlq(params.name, count);
    return { ok: true, data: jobs };
  })

  // Retry DLQ jobs
  .post(
    "/queue/retry-dlq",
    async ({ body }) => {
      const c = await getClient();
      const count = await c.retryDlq(body.queue, body.jobId);
      return { ok: true, data: { queue: body.queue, retried: count } };
    },
    {
      body: t.Object({
        queue: t.String(),
        jobId: t.Optional(t.Number()),
      }),
    }
  )

  // Set rate limit
  .post(
    "/queue/rate-limit",
    async ({ body }) => {
      const c = await getClient();
      await c.setRateLimit(body.queue, body.limit);
      return {
        ok: true,
        data: { queue: body.queue, rateLimit: body.limit },
      };
    },
    {
      body: t.Object({
        queue: t.String(),
        limit: t.Number(),
      }),
    }
  )

  // Clear rate limit
  .post(
    "/queue/rate-limit/clear",
    async ({ body }) => {
      const c = await getClient();
      await c.clearRateLimit(body.queue);
      return { ok: true, data: { queue: body.queue, rateLimit: null } };
    },
    {
      body: t.Object({
        queue: t.String(),
      }),
    }
  )

  // Start server
  .listen(API_PORT);

console.log(`
╔═══════════════════════════════════════════════════════════╗
║         flashQ Playground API - Elysia + Bun              ║
╠═══════════════════════════════════════════════════════════╣
║  Server running on: http://localhost:${API_PORT}                 ║
║  flashQ server:     ${FLASHQ_HOST}:${FLASHQ_PORT}                        ║
╚═══════════════════════════════════════════════════════════╝
`);

// Connect to flashQ on startup
initClient().catch((err) => {
  console.error("Failed to connect to flashQ:", err.message);
  console.log("Will retry on first request...");
});

export type App = typeof app;
