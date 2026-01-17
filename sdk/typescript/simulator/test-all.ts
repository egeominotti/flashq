/**
 * FlashQ Simulator - Complete Feature Test
 *
 * Tests all simulator functionality via HTTP API
 *
 * Run: bun run simulator/test-all.ts
 */

const BASE_URL = 'http://localhost:6790';
const TEST_QUEUE = 'simulator-test';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

const log = {
  success: (msg: string) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  error: (msg: string) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  info: (msg: string) => console.log(`${colors.cyan}→${colors.reset} ${msg}`),
  section: (msg: string) => console.log(`\n${colors.magenta}${colors.bold}━━━ ${msg} ━━━${colors.reset}\n`),
};

async function request(method: string, endpoint: string, body?: any) {
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${BASE_URL}${endpoint}`, options);
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return { ok: true, data: text };
  }
}

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    log.success(name);
    passed++;
  } catch (error: any) {
    log.error(`${name}: ${error.message}`);
    failed++;
  }
}

async function runTests() {
  console.log(`
${colors.magenta}${colors.bold}
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ⚡ FLASHQ SIMULATOR - COMPLETE FEATURE TEST                 ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}`);

  // ============== Health Check ==============
  log.section('HEALTH CHECK');

  await test('Server health check', async () => {
    const result = await request('GET', '/health');
    if (!result.ok || result.data.status !== 'healthy') throw new Error('Unhealthy');
  });

  // ============== Clean up before tests ==============
  log.section('CLEANUP');

  await test('Obliterate test queue', async () => {
    try {
      await request('DELETE', `/queues/${TEST_QUEUE}/obliterate`);
    } catch {} // Ignore if doesn't exist
  });

  // ============== Push Operations ==============
  log.section('PUSH OPERATIONS');

  let firstJobId: number;

  await test('Push single job', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { message: 'Hello FlashQ!', timestamp: Date.now() }
    });
    if (!result.ok || !result.data.id) throw new Error('No job ID returned');
    firstJobId = result.data.id;
    log.info(`Created job #${firstJobId}`);
  });

  await test('Push job with priority', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'priority-test' },
      priority: 100
    });
    if (!result.ok) throw new Error('Failed');
  });

  await test('Push job with delay', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'delayed' },
      delay: 5000
    });
    if (!result.ok) throw new Error('Failed');
  });

  await test('Push job with custom ID (idempotency)', async () => {
    const customId = `custom-${Date.now()}`;
    const result = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'custom-id' },
      jobId: customId
    });
    if (!result.ok) throw new Error('Failed');
    log.info(`Custom ID: ${customId}`);
  });

  await test('Push job with unique key', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'unique' },
      unique_key: `unique-test-key-${Date.now()}`
    });
    if (!result.ok) throw new Error('Failed');
  });

  await test('Push multiple jobs (sequential)', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
        data: { index: i, batch: true }
      });
      if (!result.ok) throw new Error(`Failed at job ${i}`);
    }
    log.info('Pushed 10 jobs sequentially');
  });

  // ============== Job Query ==============
  log.section('JOB QUERY');

  await test('Get job by ID', async () => {
    const result = await request('GET', `/jobs/${firstJobId}`);
    if (!result.ok) throw new Error('Job not found');
    log.info(`Job state: ${result.data.state || 'waiting'}`);
  });

  await test('Get job result (may be empty)', async () => {
    try {
      const result = await request('GET', `/jobs/${firstJobId}/result`);
      log.info(`Result: ${result.data ? 'exists' : 'none'}`);
    } catch {
      log.info('No result yet (expected)');
    }
  });

  await test('List jobs', async () => {
    const result = await request('GET', `/jobs?queue=${TEST_QUEUE}&limit=10`);
    if (!result.ok) throw new Error('Failed');
    log.info(`Listed ${result.data?.length || 0} jobs`);
  });

  // ============== Queue Operations ==============
  log.section('QUEUE OPERATIONS');

  await test('Pause queue', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/pause`);
    if (!result.ok) throw new Error('Failed');
  });

  await test('Resume queue', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/resume`);
    if (!result.ok) throw new Error('Failed');
  });

  await test('List all queues', async () => {
    const result = await request('GET', '/queues');
    if (!result.ok) throw new Error('Failed');
    const queues = Array.isArray(result.data) ? result.data : [];
    log.info(`Found ${queues.length} queues`);
  });

  // ============== Rate Limit & Concurrency ==============
  log.section('RATE LIMIT & CONCURRENCY');

  await test('Set rate limit', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/rate-limit`, { limit: 50 });
    if (!result.ok) throw new Error('Failed');
  });

  await test('Clear rate limit', async () => {
    const result = await request('DELETE', `/queues/${TEST_QUEUE}/rate-limit`);
    if (!result.ok) throw new Error('Failed');
  });

  await test('Set concurrency limit', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/concurrency`, { limit: 10 });
    if (!result.ok) throw new Error('Failed');
  });

  await test('Clear concurrency limit', async () => {
    const result = await request('DELETE', `/queues/${TEST_QUEUE}/concurrency`);
    if (!result.ok) throw new Error('Failed');
  });

  // ============== Job Management ==============
  log.section('JOB MANAGEMENT');

  // Push a job to test management operations
  const mgmtJob = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
    data: { type: 'management-test' }
  });
  const mgmtJobId = mgmtJob.data.id;

  await test('Cancel job', async () => {
    const result = await request('POST', `/jobs/${mgmtJobId}/cancel`);
    if (!result.ok) throw new Error('Failed');
  });

  // Push a job for priority test
  const prioJob = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
    data: { type: 'priority-change-test' }
  });

  await test('Change job priority', async () => {
    const result = await request('POST', `/jobs/${prioJob.data.id}/priority`, { priority: 999 });
    if (!result.ok) throw new Error('Failed');
  });

  // Push a delayed job for promote test
  const delayedJob = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
    data: { type: 'promote-test' },
    delay: 60000 // 1 minute delay
  });

  await test('Promote delayed job', async () => {
    const result = await request('POST', `/jobs/${delayedJob.data.id}/promote`);
    if (!result.ok) throw new Error('Failed');
  });

  // Push a job for discard test
  const discardJob = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
    data: { type: 'discard-test' }
  });

  await test('Discard job to DLQ', async () => {
    const result = await request('POST', `/jobs/${discardJob.data.id}/discard`);
    if (!result.ok) throw new Error('Failed');
  });

  // ============== Progress ==============
  log.section('PROGRESS');

  const progressJob = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
    data: { type: 'progress-test' }
  });

  await test('Get job progress', async () => {
    const result = await request('GET', `/jobs/${progressJob.data.id}/progress`);
    // Progress endpoint returns progress data (may be 0 for jobs not yet processed)
    log.info(`Progress: ${result.data?.progress ?? result.data ?? 0}%`);
  });

  // ============== DLQ ==============
  log.section('DEAD LETTER QUEUE');

  await test('Get DLQ jobs', async () => {
    const result = await request('GET', `/queues/${TEST_QUEUE}/dlq?count=10`);
    if (!result.ok) throw new Error('Failed');
    const jobs = Array.isArray(result.data) ? result.data : [];
    log.info(`DLQ has ${jobs.length} jobs`);
  });

  await test('Retry DLQ jobs', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/dlq/retry`, {});
    if (!result.ok) throw new Error('Failed');
    log.info(`Retried ${result.data?.retried || 0} jobs`);
  });

  // ============== Cron ==============
  log.section('CRON JOBS');

  const cronName = `test-cron-${Date.now()}`;

  await test('Add cron job', async () => {
    const result = await request('POST', `/crons/${cronName}`, {
      queue: TEST_QUEUE,
      schedule: '0 * * * * *', // Every minute
      data: { action: 'test-cron' }
    });
    if (!result.ok) throw new Error('Failed');
  });

  await test('List cron jobs', async () => {
    const result = await request('GET', '/crons');
    if (!result.ok) throw new Error('Failed');
    const crons = Array.isArray(result.data) ? result.data : [];
    log.info(`Found ${crons.length} cron jobs`);
  });

  await test('Delete cron job', async () => {
    const result = await request('DELETE', `/crons/${cronName}`);
    if (!result.ok) throw new Error('Failed');
  });

  // ============== Metrics ==============
  log.section('METRICS & STATS');

  await test('Get queue stats', async () => {
    const result = await request('GET', '/stats');
    if (!result.ok) throw new Error('Failed');
    log.info(`Stats: queued=${result.data?.queued || 0}, processing=${result.data?.processing || 0}`);
  });

  await test('Get detailed metrics', async () => {
    const result = await request('GET', '/metrics');
    if (!result.ok) throw new Error('Failed');
    log.info(`Total pushed: ${result.data?.total_pushed || 0}, completed: ${result.data?.total_completed || 0}`);
  });

  // ============== Flow (Dependencies) ==============
  log.section('FLOW / DEPENDENCIES');

  await test('Create job flow with dependencies', async () => {
    // Parent job
    const parent = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'parent', step: 'init' }
    });

    // Child jobs depending on parent
    const child1 = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'child', step: 1 },
      depends_on: [parent.data.id]
    });

    const child2 = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'child', step: 2 },
      depends_on: [parent.data.id]
    });

    // Final job depending on both children
    const final = await request('POST', `/queues/${TEST_QUEUE}/jobs`, {
      data: { type: 'final', step: 3 },
      depends_on: [child1.data.id, child2.data.id]
    });

    log.info(`Flow: Parent #${parent.data.id} → Children #${child1.data.id}, #${child2.data.id} → Final #${final.data.id}`);
  });

  // ============== Cleanup ==============
  log.section('FINAL CLEANUP');

  await test('Drain queue', async () => {
    const result = await request('POST', `/queues/${TEST_QUEUE}/drain`);
    if (!result.ok) throw new Error('Failed');
    log.info(`Drained ${result.data?.removed || 0} jobs`);
  });

  await test('Obliterate queue', async () => {
    const result = await request('DELETE', `/queues/${TEST_QUEUE}/obliterate`);
    if (!result.ok) throw new Error('Failed');
  });

  // ============== Summary ==============
  console.log(`
${colors.magenta}${colors.bold}
╔═══════════════════════════════════════════════════════════════╗
║                         TEST RESULTS                          ║
╠═══════════════════════════════════════════════════════════════╣
║                                                               ║
║   ${colors.green}PASSED: ${passed.toString().padEnd(3)}${colors.magenta}                                             ║
║   ${colors.red}FAILED: ${failed.toString().padEnd(3)}${colors.magenta}                                             ║
║                                                               ║
║   ${passed > 0 && failed === 0 ? `${colors.green}ALL TESTS PASSED! ✓` : `${colors.yellow}SOME TESTS NEED ATTENTION`}${colors.magenta}                       ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(console.error);
