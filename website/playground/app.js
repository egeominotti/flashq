/**
 * flashQ Playground - Professional Dashboard
 * Real-time job queue testing with auto-worker
 */

const API_URL = 'https://api.flashq.dev';
const WORKER_API_URL = 'https://api.flashq.dev/worker';

// State
const state = {
  isConnected: false,
  totalPushed: 0,
  workerRunning: false,
  workerProcessed: 0,
  workerStartTime: 0,
  throughputHistory: new Array(60).fill(0),
  lastCompleted: 0,
  chartCtx: null
};

// DOM Elements cache
const $ = (id) => document.getElementById(id);

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  bindEvents();
  checkConnection();
  startStatsRefresh();
  document.getElementById('year').textContent = new Date().getFullYear();
});

// Event bindings
function bindEvents() {
  $('pushBtn').addEventListener('click', handlePush);
  $('benchmarkBtn').addEventListener('click', handleBenchmark);
  $('startWorkerBtn').addEventListener('click', startWorker);
  $('stopWorkerBtn').addEventListener('click', stopWorker);
  $('pauseBtn').addEventListener('click', () => queueAction('pause'));
  $('resumeBtn').addEventListener('click', () => queueAction('resume'));
  $('drainBtn').addEventListener('click', () => queueAction('drain'));
  $('clearLogBtn').addEventListener('click', clearLog);
}

// Connection check
async function checkConnection() {
  setConnectionState('loading');
  try {
    const res = await fetch(`${WORKER_API_URL}/health`);
    const data = await res.json();
    if (data.ok) {
      setConnectionState('connected');
      state.isConnected = true;
      log('Connected to flashQ server', 'success');
      refreshStats();
    } else {
      throw new Error('Health check failed');
    }
  } catch (err) {
    setConnectionState('error');
    state.isConnected = false;
    log('Connection failed: ' + err.message, 'error');
  }
}

function setConnectionState(status) {
  const el = $('connectionStatus');
  el.className = 'connection-status fade-in ' + status;
  const textEl = el.querySelector('.status-text');
  if (status === 'connected') textEl.textContent = 'Connected to';
  else if (status === 'loading') textEl.textContent = 'Connecting to';
  else textEl.textContent = 'Failed to connect to';
}

// Stats refresh
function startStatsRefresh() {
  setInterval(refreshStats, 2000);
  setInterval(updateThroughput, 1000);
}

async function refreshStats() {
  if (!state.isConnected) return;
  try {
    const res = await fetch(`${WORKER_API_URL}/metrics`);
    const data = await res.json();
    if (data.ok) {
      const m = data.data;
      let queued = 0, processing = 0, dlq = 0;
      for (const q of m.queues || []) {
        queued += q.pending || 0;
        processing += q.processing || 0;
        dlq += q.dlq || 0;
      }

      $('statQueued').textContent = formatNumber(queued);
      $('statProcessing').textContent = formatNumber(processing);
      $('statCompleted').textContent = formatNumber(m.total_completed || 0);
      $('statFailed').textContent = formatNumber(m.total_failed || dlq);

      $('queueCount').textContent = formatNumber(queued);
      $('processCount').textContent = formatNumber(processing);
      $('completeCount').textContent = formatNumber(m.total_completed || 0);

      // Calculate throughput
      const newCompleted = m.total_completed || 0;
      const throughput = Math.max(0, newCompleted - state.lastCompleted);
      state.lastCompleted = newCompleted;

      // Update throughput display
      $('throughputValue').textContent = Math.round(m.jobs_per_second || 0);
    }
  } catch {}
}

function updateThroughput() {
  // Shift history and add current
  state.throughputHistory.shift();
  state.throughputHistory.push(parseInt($('throughputValue').textContent) || 0);
  drawChart();
}

// Push job
async function handlePush() {
  if (!state.isConnected) return toast('Not connected', true);

  const queue = $('queueName').value || 'demo';
  const priority = parseInt($('priority').value) || 0;
  const delay = parseInt($('delay').value) || 0;

  let data;
  try {
    data = JSON.parse($('jobData').value);
  } catch {
    return toast('Invalid JSON', true);
  }

  setLoading($('pushBtn'), true);

  try {
    const start = performance.now();
    const res = await fetch(`${WORKER_API_URL}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue, data, priority, delay })
    });
    const result = await res.json();
    const elapsed = Math.round(performance.now() - start);

    if (result.ok) {
      state.totalPushed++;
      $('pushCount').textContent = state.totalPushed;
      log(`Pushed job #${result.data.id} to "${queue}" (${elapsed}ms)`, 'success');
      toast(`Job #${result.data.id} pushed!`);
      pulseStage('stagePush');
      spawnParticle('particles1');
      refreshStats();
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    log('Push failed: ' + err.message, 'error');
    toast(err.message, true);
  } finally {
    setLoading($('pushBtn'), false, 'Push Job');
  }
}

// Benchmark
async function handleBenchmark() {
  if (!state.isConnected) return toast('Not connected', true);

  const count = parseInt($('benchmarkCount').value) || 1000;
  const queue = 'benchmark-' + Date.now();
  const batchSize = 50;
  let pushed = 0;

  setLoading($('benchmarkBtn'), true, 'Running...');
  $('benchmarkResult').classList.add('hidden');

  const start = performance.now();
  log(`Starting benchmark: ${count} jobs`, 'info');

  try {
    while (pushed < count) {
      const batch = Math.min(batchSize, count - pushed);
      const jobs = Array.from({ length: batch }, (_, i) => ({
        data: { index: pushed + i, ts: Date.now() },
        priority: Math.floor(Math.random() * 10)
      }));

      const res = await fetch(`${WORKER_API_URL}/push-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue, jobs })
      });

      if (!(await res.json()).ok) throw new Error('Batch push failed');

      pushed += batch;
      state.totalPushed += batch;
      $('pushCount').textContent = state.totalPushed;
      spawnParticle('particles1');
    }

    const elapsed = performance.now() - start;
    const throughput = Math.round((count / elapsed) * 1000);

    $('bmThroughput').textContent = throughput.toLocaleString() + ' jobs/sec';
    $('bmTime').textContent = Math.round(elapsed) + 'ms';
    $('benchmarkResult').classList.remove('hidden');

    log(`Benchmark: ${count} jobs in ${Math.round(elapsed)}ms (${throughput.toLocaleString()} jobs/sec)`, 'success');
    toast(`${throughput.toLocaleString()} jobs/sec!`);
    refreshStats();
  } catch (err) {
    log('Benchmark failed: ' + err.message, 'error');
    toast(err.message, true);
  } finally {
    setLoading($('benchmarkBtn'), false, 'Run Benchmark');
  }
}

// Auto Worker
function startWorker() {
  if (state.workerRunning) return;

  const queue = $('workerQueue').value || 'demo';
  const concurrency = parseInt($('workerConcurrency').value) || 5;

  state.workerRunning = true;
  state.workerProcessed = 0;
  state.workerStartTime = Date.now();

  $('startWorkerBtn').disabled = true;
  $('stopWorkerBtn').disabled = false;
  $('workerStats').classList.remove('hidden');

  log(`Worker started: ${concurrency} concurrent processors on "${queue}"`, 'info');

  // Start multiple concurrent workers
  for (let i = 0; i < concurrency; i++) {
    runWorkerLoop(queue, i);
  }

  // Update worker stats
  state.workerStatsInterval = setInterval(updateWorkerStats, 500);
}

async function runWorkerLoop(queue, workerId) {
  while (state.workerRunning) {
    try {
      const res = await fetch(`${WORKER_API_URL}/pull-and-ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue, processingTime: 10 })
      });

      const result = await res.json();

      if (result.ok && result.data) {
        state.workerProcessed++;
        pulseStage('stageProcess');
        spawnParticle('particles2');
        spawnParticle('particles3');
      } else {
        // No jobs available, wait a bit
        await sleep(100);
      }
    } catch {
      await sleep(500);
    }
  }
}

function stopWorker() {
  state.workerRunning = false;

  $('startWorkerBtn').disabled = false;
  $('stopWorkerBtn').disabled = true;

  if (state.workerStatsInterval) {
    clearInterval(state.workerStatsInterval);
  }

  log(`Worker stopped. Processed ${state.workerProcessed} jobs.`, 'warning');
  refreshStats();
}

function updateWorkerStats() {
  const elapsed = (Date.now() - state.workerStartTime) / 1000;
  const rate = elapsed > 0 ? Math.round(state.workerProcessed / elapsed) : 0;

  $('workerProcessed').textContent = state.workerProcessed.toLocaleString();
  $('workerRate').textContent = rate + '/s';
}

// Queue actions
async function queueAction(action) {
  if (!state.isConnected) return toast('Not connected', true);

  const queue = $('actionQueue').value || 'demo';
  const btn = $(`${action}Btn`);
  setLoading(btn, true);

  try {
    const res = await fetch(`${WORKER_API_URL}/queue/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queue })
    });

    const result = await res.json();

    if (result.ok) {
      const msg = action === 'drain'
        ? `Queue "${queue}" drained (${result.data?.drained || 0} jobs removed)`
        : `Queue "${queue}" ${action}d`;
      log(msg, action === 'drain' ? 'warning' : 'success');
      toast(msg);
      refreshStats();
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    log(`${action} failed: ${err.message}`, 'error');
    toast(err.message, true);
  } finally {
    setLoading(btn, false, action.charAt(0).toUpperCase() + action.slice(1));
  }
}

// Chart
function initChart() {
  const canvas = $('chartCanvas');
  state.chartCtx = canvas.getContext('2d');

  // Set canvas size
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  drawChart();
}

function drawChart() {
  const ctx = state.chartCtx;
  const canvas = ctx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  const data = state.throughputHistory;
  const max = Math.max(...data, 1);

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Draw grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const y = (h / 5) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Draw area
  const barWidth = w / data.length;

  ctx.fillStyle = 'rgba(249, 115, 22, 0.3)';
  ctx.beginPath();
  ctx.moveTo(0, h);

  for (let i = 0; i < data.length; i++) {
    const x = i * barWidth;
    const y = h - (data[i] / max) * (h - 10);
    ctx.lineTo(x, y);
  }

  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // Draw line
  ctx.strokeStyle = '#f97316';
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let i = 0; i < data.length; i++) {
    const x = i * barWidth;
    const y = h - (data[i] / max) * (h - 10);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
}

// UI Helpers
function setLoading(btn, loading, text = '') {
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<div class="spinner"></div>${text ? `<span>${text}</span>` : ''}`
    : `<span>${text}</span>`;
}

function pulseStage(id) {
  const el = $(id);
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 1000);
}

function spawnParticle(containerId) {
  const container = $(containerId);
  if (!container) return;

  const particle = document.createElement('div');
  particle.className = 'particle';
  particle.style.top = '-2px';
  container.appendChild(particle);

  setTimeout(() => particle.remove(), 1000);
}

function log(message, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${message}</span>`;

  const container = $('activityLog');
  container.insertBefore(entry, container.firstChild);

  // Keep max 100 entries
  while (container.children.length > 100) {
    container.removeChild(container.lastChild);
  }
}

function clearLog() {
  $('activityLog').innerHTML = `
    <div class="log-entry info">
      <span class="log-time">${new Date().toLocaleTimeString()}</span>
      <span class="log-msg">Log cleared</span>
    </div>`;
}

function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = 'toast show' + (isError ? ' error' : '');
  setTimeout(() => el.className = 'toast', 3000);
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
