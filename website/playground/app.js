/**
 * flashQ Playground
 * Interactive demo connected to api.flashq.dev
 */

const API_URL = 'https://api.flashq.dev';
const WORKER_API_URL = 'https://api.flashq.dev/worker';

// State
const state = {
  isConnected: false,
  totalPushed: 0
};

// DOM Elements
const elements = {
  // Connection
  connectionBanner: null,

  // Push Job
  pushBtn: null,
  queueName: null,
  jobData: null,
  priority: null,
  delay: null,

  // Benchmark
  benchmarkBtn: null,
  benchmarkCount: null,
  benchmarkResults: null,
  benchmarkProgress: null,
  progressFill: null,
  progressText: null,
  progressPercent: null,
  bmJobs: null,
  bmTime: null,
  bmThroughput: null,

  // Get Job
  getJobBtn: null,
  getJobId: null,

  // Worker Simulator
  workerQueue: null,
  pullAckBtn: null,
  pullFailBtn: null,
  workerResult: null,

  // Queue Controls
  controlQueue: null,
  pauseBtn: null,
  resumeBtn: null,
  drainBtn: null,

  // Stats
  statQueued: null,
  statProcessing: null,
  statDelayed: null,
  statCompleted: null,
  statDlq: null,

  // Flow
  jobsFlow: null,
  flowPush: null,
  flowPushCount: null,
  flowQueueCount: null,
  flowProcessCount: null,
  flowCompleteCount: null,

  // Log
  logContainer: null,
  clearLogBtn: null,

  // Toast
  toast: null,

  // Footer
  year: null
};

/**
 * Initialize the application
 */
function init() {
  cacheElements();
  bindEvents();
  initFadeAnimations();
  setYear();
  checkConnection();
  startStatsRefresh();
}

/**
 * Cache DOM elements
 */
function cacheElements() {
  elements.connectionBanner = document.getElementById('connectionBanner');
  elements.pushBtn = document.getElementById('pushBtn');
  elements.queueName = document.getElementById('queueName');
  elements.jobData = document.getElementById('jobData');
  elements.priority = document.getElementById('priority');
  elements.delay = document.getElementById('delay');
  elements.benchmarkBtn = document.getElementById('benchmarkBtn');
  elements.benchmarkCount = document.getElementById('benchmarkCount');
  elements.benchmarkResults = document.getElementById('benchmarkResults');
  elements.benchmarkProgress = document.getElementById('benchmarkProgress');
  elements.progressFill = document.getElementById('progressFill');
  elements.progressText = document.getElementById('progressText');
  elements.progressPercent = document.getElementById('progressPercent');
  elements.bmJobs = document.getElementById('bmJobs');
  elements.bmTime = document.getElementById('bmTime');
  elements.bmThroughput = document.getElementById('bmThroughput');
  elements.getJobBtn = document.getElementById('getJobBtn');
  elements.getJobId = document.getElementById('getJobId');

  // Worker Simulator
  elements.workerQueue = document.getElementById('workerQueue');
  elements.pullAckBtn = document.getElementById('pullAckBtn');
  elements.pullFailBtn = document.getElementById('pullFailBtn');
  elements.workerResult = document.getElementById('workerResult');

  // Queue Controls
  elements.controlQueue = document.getElementById('controlQueue');
  elements.pauseBtn = document.getElementById('pauseBtn');
  elements.resumeBtn = document.getElementById('resumeBtn');
  elements.drainBtn = document.getElementById('drainBtn');

  elements.statQueued = document.getElementById('statQueued');
  elements.statProcessing = document.getElementById('statProcessing');
  elements.statDelayed = document.getElementById('statDelayed');
  elements.statCompleted = document.getElementById('statCompleted');
  elements.statDlq = document.getElementById('statDlq');
  elements.jobsFlow = document.getElementById('jobsFlow');
  elements.flowPush = document.getElementById('flowPush');
  elements.flowPushCount = document.getElementById('flowPushCount');
  elements.flowQueueCount = document.getElementById('flowQueueCount');
  elements.flowProcessCount = document.getElementById('flowProcessCount');
  elements.flowCompleteCount = document.getElementById('flowCompleteCount');
  elements.logContainer = document.getElementById('logContainer');
  elements.clearLogBtn = document.getElementById('clearLogBtn');
  elements.toast = document.getElementById('toast');
  elements.year = document.getElementById('year');
}

/**
 * Bind event listeners
 */
function bindEvents() {
  elements.pushBtn.addEventListener('click', handlePushJob);
  elements.benchmarkBtn.addEventListener('click', handleBenchmark);
  elements.getJobBtn.addEventListener('click', handleGetJob);
  elements.clearLogBtn.addEventListener('click', handleClearLog);

  // Worker Simulator
  elements.pullAckBtn.addEventListener('click', handlePullAndAck);
  elements.pullFailBtn.addEventListener('click', handlePullAndFail);

  // Queue Controls
  elements.pauseBtn.addEventListener('click', handlePause);
  elements.resumeBtn.addEventListener('click', handleResume);
  elements.drainBtn.addEventListener('click', handleDrain);
}

/**
 * Initialize fade-in animations
 */
function initFadeAnimations() {
  document.querySelectorAll('.fade-in').forEach((el, i) => {
    setTimeout(() => el.classList.add('visible'), i * 100);
  });
}

/**
 * Set current year in footer
 */
function setYear() {
  elements.year.textContent = new Date().getFullYear();
}

/**
 * Start stats refresh interval
 */
function startStatsRefresh() {
  setInterval(refreshStats, 3000);
}

// ============================================
// API Functions
// ============================================

/**
 * Check connection to flashQ server
 */
async function checkConnection() {
  setConnectionState('loading');

  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();

    if (data.ok) {
      setConnectionState('connected');
      state.isConnected = true;
      log('Connected to flashQ server', 'success');
      refreshStats();
    } else {
      throw new Error('Health check failed');
    }
  } catch (error) {
    setConnectionState('error');
    state.isConnected = false;
    log('Connection failed: ' + error.message, 'error');
  }
}

/**
 * Push a job to the queue
 */
async function handlePushJob() {
  if (!state.isConnected) {
    showToast('Not connected', true);
    return;
  }

  const queue = elements.queueName.value || 'demo';
  const priority = parseInt(elements.priority.value) || 0;
  const delayMs = parseInt(elements.delay.value) || 0;

  let data;
  try {
    data = JSON.parse(elements.jobData.value);
  } catch {
    showToast('Invalid JSON', true);
    return;
  }

  setButtonLoading(elements.pushBtn, true);

  try {
    const start = performance.now();
    const response = await fetch(`${API_URL}/queues/${queue}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, priority, delay: delayMs })
    });

    const result = await response.json();
    const elapsed = (performance.now() - start).toFixed(0);

    if (result.ok) {
      state.totalPushed++;
      elements.flowPushCount.textContent = state.totalPushed;
      elements.getJobId.value = result.data.id;

      log(`Pushed job #${result.data.id} to "${queue}" (${elapsed}ms)`, 'success');
      showToast(`Job #${result.data.id} pushed!`);

      animateJobFlow();
      pulseElement(elements.flowPush);
      refreshStats();
    } else {
      throw new Error(result.error || 'Push failed');
    }
  } catch (error) {
    log('Push failed: ' + error.message, 'error');
    showToast(error.message, true);
  } finally {
    setButtonLoading(elements.pushBtn, false, 'Push Job');
  }
}

/**
 * Run benchmark stress test
 */
async function handleBenchmark() {
  if (!state.isConnected) {
    showToast('Not connected', true);
    return;
  }

  const count = parseInt(elements.benchmarkCount.value) || 100;
  const queue = 'benchmark-' + Date.now();
  const batchSize = 50;
  let pushed = 0;

  setButtonLoading(elements.benchmarkBtn, true, 'Running...');
  elements.benchmarkResults.classList.add('hidden');
  elements.benchmarkProgress.classList.remove('hidden');

  const start = performance.now();

  try {
    log(`Starting benchmark: ${count} jobs`, 'info');

    while (pushed < count) {
      const batch = Math.min(batchSize, count - pushed);

      // Push jobs in parallel batches
      const promises = Array.from({ length: batch }, (_, i) =>
        fetch(`${API_URL}/queues/${queue}/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: { index: pushed + i, timestamp: Date.now() },
            priority: Math.floor(Math.random() * 10)
          })
        })
      );

      const responses = await Promise.all(promises);

      // Check all responses
      for (const response of responses) {
        if (!response.ok) throw new Error('Push failed');
      }

      pushed += batch;
      state.totalPushed += batch;

      updateProgress(pushed, count);
      elements.flowPushCount.textContent = state.totalPushed;
      animateJobFlow();
    }

    const elapsed = performance.now() - start;
    const throughput = Math.round((count / elapsed) * 1000);

    displayBenchmarkResults(count, elapsed, throughput);
    log(`Benchmark complete: ${count} jobs in ${elapsed.toFixed(0)}ms (${throughput.toLocaleString()} jobs/sec)`, 'success');
    showToast(`${throughput.toLocaleString()} jobs/sec!`);

    refreshStats();
  } catch (error) {
    log('Benchmark failed: ' + error.message, 'error');
    showToast(error.message, true);
  } finally {
    setButtonLoading(elements.benchmarkBtn, false, 'Run Benchmark');
    setTimeout(() => elements.benchmarkProgress.classList.add('hidden'), 2000);
  }
}

/**
 * Get job details
 */
async function handleGetJob() {
  const jobId = elements.getJobId.value;
  if (!jobId) {
    showToast('Enter a job ID', true);
    return;
  }

  try {
    const response = await fetch(`${API_URL}/jobs/${jobId}`);
    const result = await response.json();

    if (result.ok) {
      log(`Job #${jobId}: ${result.data.state || 'unknown'}`, 'info');
      showToast(`State: ${result.data.state || 'unknown'}`);
    } else {
      log(`Job #${jobId} not found`, 'warning');
      showToast('Job not found', true);
    }
  } catch (error) {
    log('Get job failed: ' + error.message, 'error');
  }
}

/**
 * Pull a job and acknowledge it (simulates successful processing)
 * Uses the SDK-based backend for real worker simulation
 */
async function handlePullAndAck() {
  if (!state.isConnected) {
    showToast('Not connected', true);
    return;
  }

  const queue = elements.workerQueue.value || 'demo';
  setButtonLoading(elements.pullAckBtn, true);

  try {
    const start = performance.now();

    // Use SDK-based worker API for real pull+ack
    const response = await fetch(`${WORKER_API_URL}/pull-and-ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue, processingTime: 100 })
    });

    const result = await response.json();
    const elapsed = (performance.now() - start).toFixed(0);

    if (!result.ok) {
      throw new Error(result.error || 'Operation failed');
    }

    if (!result.data) {
      showWorkerResult('No jobs available in queue', false);
      log(`No jobs to pull from "${queue}"`, 'warning');
      return;
    }

    const { job, status } = result.data;
    showWorkerResult(`Job #${job.id} completed! (${elapsed}ms)\nData: ${JSON.stringify(job.data, null, 2)}`, true);
    log(`Job #${job.id} pulled and acknowledged (${elapsed}ms)`, 'success');
    showToast(`Job #${job.id} completed!`);
    animateJobFlow();
    refreshStats();
  } catch (error) {
    showWorkerResult(`Error: ${error.message}`, false);
    log('Pull & Ack failed: ' + error.message, 'error');
    showToast(error.message, true);
  } finally {
    setButtonLoading(elements.pullAckBtn, false, 'Pull & Ack');
  }
}

/**
 * Pull a job and fail it (simulates failed processing)
 * Uses the SDK-based backend for real worker simulation
 */
async function handlePullAndFail() {
  if (!state.isConnected) {
    showToast('Not connected', true);
    return;
  }

  const queue = elements.workerQueue.value || 'demo';
  setButtonLoading(elements.pullFailBtn, true);

  try {
    const start = performance.now();

    // Use SDK-based worker API for real pull+fail
    const response = await fetch(`${WORKER_API_URL}/pull-and-fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue, error: 'Simulated failure from playground' })
    });

    const result = await response.json();
    const elapsed = (performance.now() - start).toFixed(0);

    if (!result.ok) {
      throw new Error(result.error || 'Operation failed');
    }

    if (!result.data) {
      showWorkerResult('No jobs available in queue', false);
      log(`No jobs to pull from "${queue}"`, 'warning');
      return;
    }

    const { job, error } = result.data;
    showWorkerResult(`Job #${job.id} failed! (${elapsed}ms)\nSent to DLQ or retry queue.\nData: ${JSON.stringify(job.data, null, 2)}`, false);
    log(`Job #${job.id} pulled and failed (${elapsed}ms)`, 'error');
    showToast(`Job #${job.id} failed!`, true);
    refreshStats();
  } catch (error) {
    showWorkerResult(`Error: ${error.message}`, false);
    log('Pull & Fail failed: ' + error.message, 'error');
    showToast(error.message, true);
  } finally {
    setButtonLoading(elements.pullFailBtn, false, 'Pull & Fail');
  }
}

/**
 * Show worker result
 */
function showWorkerResult(message, isSuccess) {
  elements.workerResult.textContent = message;
  elements.workerResult.className = 'worker-result ' + (isSuccess ? 'success' : 'error');
  elements.workerResult.classList.remove('hidden');
}

/**
 * Pause a queue
 * Uses the SDK-based backend
 */
async function handlePause() {
  if (!state.isConnected) {
    showToast('Not connected', true);
    return;
  }

  const queue = elements.controlQueue.value || 'demo';
  setButtonLoading(elements.pauseBtn, true);

  try {
    const response = await fetch(`${WORKER_API_URL}/queue/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue })
    });

    const result = await response.json();

    if (result.ok) {
      log(`Queue "${queue}" paused`, 'warning');
      showToast(`Queue "${queue}" paused`);
    } else {
      throw new Error(result.error || 'Pause failed');
    }
  } catch (error) {
    log('Pause failed: ' + error.message, 'error');
    showToast(error.message, true);
  } finally {
    setButtonLoading(elements.pauseBtn, false, 'Pause');
  }
}

/**
 * Resume a queue
 * Uses the SDK-based backend
 */
async function handleResume() {
  if (!state.isConnected) {
    showToast('Not connected', true);
    return;
  }

  const queue = elements.controlQueue.value || 'demo';
  setButtonLoading(elements.resumeBtn, true);

  try {
    const response = await fetch(`${WORKER_API_URL}/queue/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue })
    });

    const result = await response.json();

    if (result.ok) {
      log(`Queue "${queue}" resumed`, 'success');
      showToast(`Queue "${queue}" resumed`);
    } else {
      throw new Error(result.error || 'Resume failed');
    }
  } catch (error) {
    log('Resume failed: ' + error.message, 'error');
    showToast(error.message, true);
  } finally {
    setButtonLoading(elements.resumeBtn, false, 'Resume');
  }
}

/**
 * Drain a queue (remove all waiting jobs)
 * Uses the SDK-based backend
 */
async function handleDrain() {
  if (!state.isConnected) {
    showToast('Not connected', true);
    return;
  }

  const queue = elements.controlQueue.value || 'demo';
  setButtonLoading(elements.drainBtn, true);

  try {
    const response = await fetch(`${WORKER_API_URL}/queue/drain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue })
    });

    const result = await response.json();

    if (result.ok) {
      const drained = result.data?.drained || 0;
      log(`Queue "${queue}" drained - ${drained} jobs removed`, 'warning');
      showToast(`Queue "${queue}" drained (${drained} jobs)`);
      refreshStats();
    } else {
      throw new Error(result.error || 'Drain failed');
    }
  } catch (error) {
    log('Drain failed: ' + error.message, 'error');
    showToast(error.message, true);
  } finally {
    setButtonLoading(elements.drainBtn, false, 'Drain');
  }
}

/**
 * Refresh stats from server
 */
async function refreshStats() {
  if (!state.isConnected) return;

  try {
    // Use /metrics for full stats including total_completed
    const response = await fetch(`${API_URL}/metrics`);
    const result = await response.json();

    if (result.ok) {
      const { total_completed, total_failed, queues } = result.data;

      // Calculate totals from all queues
      let queued = 0;
      let processing = 0;
      let dlq = 0;

      for (const q of queues) {
        queued += q.pending || 0;
        processing += q.processing || 0;
        dlq += q.dlq || 0;
      }

      elements.statQueued.textContent = queued;
      elements.statProcessing.textContent = processing;
      elements.statDelayed.textContent = 0; // Delayed not in metrics, using 0
      elements.statCompleted.textContent = total_completed || 0;
      elements.statDlq.textContent = total_failed || dlq || 0;

      elements.flowQueueCount.textContent = queued;
      elements.flowProcessCount.textContent = processing;
      elements.flowCompleteCount.textContent = total_completed || 0;
    }
  } catch {
    // Silently ignore stats refresh errors
  }
}

// ============================================
// UI Helpers
// ============================================

/**
 * Set connection banner state
 */
function setConnectionState(state) {
  const classes = ['connection-banner', 'fade-in', 'visible'];
  if (state !== 'connected') classes.push(state);
  elements.connectionBanner.className = classes.join(' ');
}

/**
 * Set button loading state
 */
function setButtonLoading(button, isLoading, text = '') {
  button.disabled = isLoading;
  if (isLoading) {
    button.innerHTML = `<div class="spinner"></div>${text ? `<span>${text}</span>` : ''}`;
  } else {
    button.innerHTML = `<span>${text}</span>`;
  }
}

/**
 * Update progress bar
 */
function updateProgress(current, total) {
  const percent = Math.round((current / total) * 100);
  elements.progressFill.style.width = percent + '%';
  elements.progressText.textContent = `${current} / ${total}`;
  elements.progressPercent.textContent = percent + '%';
}

/**
 * Display benchmark results
 */
function displayBenchmarkResults(jobs, time, throughput) {
  elements.bmJobs.textContent = jobs;
  elements.bmTime.textContent = time.toFixed(0) + 'ms';
  elements.bmThroughput.textContent = throughput.toLocaleString() + ' jobs/sec';
  elements.benchmarkResults.classList.remove('hidden');
}

/**
 * Animate job flowing through pipeline
 */
function animateJobFlow() {
  const particle = document.createElement('div');
  particle.className = 'job-particle';
  particle.style.top = (30 + Math.random() * 40) + '%';
  elements.jobsFlow.appendChild(particle);
  setTimeout(() => particle.remove(), 2000);
}

/**
 * Pulse animation on element
 */
function pulseElement(element) {
  element.classList.add('active');
  setTimeout(() => element.classList.remove('active'), 1000);
}

/**
 * Add log entry
 */
function log(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-message">${message}</span>`;

  elements.logContainer.insertBefore(entry, elements.logContainer.firstChild);

  // Keep only last 100 entries
  while (elements.logContainer.children.length > 100) {
    elements.logContainer.removeChild(elements.logContainer.lastChild);
  }
}

/**
 * Clear activity log
 */
function handleClearLog() {
  elements.logContainer.innerHTML = `
    <div class="log-entry info">
      <span class="log-time">--:--:--</span>
      <span class="log-message">Log cleared</span>
    </div>
  `;
}

/**
 * Show toast notification
 */
function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => elements.toast.className = 'toast', 3000);
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
