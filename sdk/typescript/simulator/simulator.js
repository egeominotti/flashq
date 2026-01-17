/**
 * FlashQ Simulator - Real-Time Controller
 *
 * Full real-time functionality with WebSocket, SSE, and live updates
 */

// ============== State ==============
const state = {
  connected: false,
  host: 'localhost',
  port: 6790,
  token: '',
  workerRunning: false,
  workerStats: { processed: 0, failed: 0, active: 0 },

  // Real-time
  ws: null,
  sse: null,
  statsInterval: null,
  liveJobs: [],
  recentActivity: [],
  throughput: { push: 0, pull: 0, ack: 0 },
  throughputHistory: [],
  lastStats: { total: 0, completed: 0, processing: 0, failed: 0, queued: 0 },

  // Animation
  animatedStats: { total: 0, completed: 0, processing: 0, failed: 0, queued: 0 }
};

// ============== API Client ==============
class FlashQHttpClient {
  constructor(host, port, token) {
    this.baseUrl = `http://${host}:${port}`;
    this.token = token;
  }

  async request(method, endpoint, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return response.json();
  }

  // Core Operations
  async push(queue, data, options = {}) {
    return this.request('POST', `/queues/${queue}/jobs`, { data, ...options });
  }

  async pushBatch(queue, jobs) {
    const ids = [];
    for (const job of jobs) {
      const result = await this.push(queue, job.data, job);
      if (result.ok) ids.push(result.data.id);
    }
    return { ok: true, data: { ids } };
  }

  async pull(queue, timeout = 1000) {
    return this.request('GET', `/queues/${queue}/jobs?timeout=${timeout}`);
  }

  async ack(jobId, result = null) {
    return this.request('POST', `/jobs/${jobId}/ack`, { result });
  }

  async fail(jobId, error = null) {
    return this.request('POST', `/jobs/${jobId}/fail`, { error });
  }

  // Job Query
  async getJob(jobId) { return this.request('GET', `/jobs/${jobId}`); }
  async getJobByCustomId(customId) { return this.request('GET', `/jobs?custom_id=${customId}`); }
  async getState(jobId) {
    const job = await this.getJob(jobId);
    return { ok: true, data: { state: job.data?.state || 'unknown' } };
  }
  async getResult(jobId) { return this.request('GET', `/jobs/${jobId}/result`); }
  async getJobs(queue, state = null, limit = 20, offset = 0) {
    let url = `/jobs?queue=${queue}&limit=${limit}&offset=${offset}`;
    if (state) url += `&state=${state}`;
    return this.request('GET', url);
  }

  // Job Management
  async cancel(jobId) { return this.request('POST', `/jobs/${jobId}/cancel`); }
  async progress(jobId, progress, message = null) {
    return this.request('POST', `/jobs/${jobId}/progress`, { progress, message });
  }
  async getProgress(jobId) { return this.request('GET', `/jobs/${jobId}/progress`); }
  async finished(jobId, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const job = await this.getJob(jobId);
        if (job.data?.state === 'completed' || job.data?.state === 'failed') return job;
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Timeout waiting for job');
  }
  async changePriority(jobId, priority) {
    return this.request('POST', `/jobs/${jobId}/priority`, { priority });
  }
  async promote(jobId) { return this.request('POST', `/jobs/${jobId}/promote`); }
  async discard(jobId) { return this.request('POST', `/jobs/${jobId}/discard`); }

  // Queue Management
  async pause(queue) { return this.request('POST', `/queues/${queue}/pause`); }
  async resume(queue) { return this.request('POST', `/queues/${queue}/resume`); }
  async drain(queue) { return this.request('POST', `/queues/${queue}/drain`); }
  async obliterate(queue) { return this.request('DELETE', `/queues/${queue}/obliterate`); }
  async listQueues() { return this.request('GET', '/queues'); }

  // DLQ
  async getDlq(queue, count = 10) { return this.request('GET', `/queues/${queue}/dlq?count=${count}`); }
  async retryDlq(queue, jobId = null) {
    const body = jobId ? { job_id: jobId } : {};
    return this.request('POST', `/queues/${queue}/dlq/retry`, body);
  }

  // Rate Limiting
  async setRateLimit(queue, limit) { return this.request('POST', `/queues/${queue}/rate-limit`, { limit }); }
  async clearRateLimit(queue) { return this.request('DELETE', `/queues/${queue}/rate-limit`); }
  async setConcurrency(queue, limit) { return this.request('POST', `/queues/${queue}/concurrency`, { limit }); }
  async clearConcurrency(queue) { return this.request('DELETE', `/queues/${queue}/concurrency`); }

  // Cron
  async addCron(name, options) { return this.request('POST', `/crons/${name}`, options); }
  async deleteCron(name) { return this.request('DELETE', `/crons/${name}`); }
  async listCrons() { return this.request('GET', '/crons'); }

  // Monitoring
  async stats() { return this.request('GET', '/stats'); }
  async metrics() { return this.request('GET', '/metrics'); }
  async health() { return this.request('GET', '/health'); }
}

let client = null;

// ============== Real-Time: WebSocket ==============
function connectWebSocket() {
  const wsUrl = `ws://${state.host}:${state.port}/ws${state.token ? `?token=${state.token}` : ''}`;

  try {
    state.ws = new WebSocket(wsUrl);

    state.ws.onopen = () => {
      log('WebSocket connected', 'success');
      addActivity('system', 'WebSocket real-time connection established');
    };

    state.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleRealTimeEvent(data);
      } catch (e) {
        // Non-JSON message
      }
    };

    state.ws.onclose = () => {
      log('WebSocket disconnected', 'warning');
      // Reconnect after 2 seconds
      if (state.connected) {
        setTimeout(connectWebSocket, 2000);
      }
    };

    state.ws.onerror = (error) => {
      // WebSocket not available, use polling
      log('WebSocket unavailable, using polling mode', 'info');
    };
  } catch (e) {
    log('WebSocket connection failed', 'warning');
  }
}

function handleRealTimeEvent(event) {
  const { type, data } = event;

  switch (type) {
    case 'job:completed':
      addActivity('completed', `Job #${data.id} completed`, data);
      flashStat('completed');
      break;
    case 'job:failed':
      addActivity('failed', `Job #${data.id} failed: ${data.error}`, data);
      flashStat('failed');
      break;
    case 'job:progress':
      addActivity('progress', `Job #${data.id} progress: ${data.progress}%`, data);
      break;
    case 'job:active':
      addActivity('active', `Job #${data.id} started processing`, data);
      flashStat('processing');
      break;
    case 'job:waiting':
      addActivity('waiting', `Job #${data.id} queued`, data);
      flashStat('queued');
      break;
  }
}

// ============== Real-Time: SSE ==============
function connectSSE(queue) {
  const sseUrl = `http://${state.host}:${state.port}/events/${queue}${state.token ? `?token=${state.token}` : ''}`;

  try {
    state.sse = new EventSource(sseUrl);

    state.sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleRealTimeEvent(data);
      } catch (e) {}
    };

    state.sse.onerror = () => {
      // SSE not available
    };
  } catch (e) {}
}

// ============== Real-Time: Polling ==============
function startRealTimePolling() {
  if (state.statsInterval) clearInterval(state.statsInterval);

  const pollStats = async () => {
    if (!client || !state.connected) return;

    try {
      const [stats, metrics] = await Promise.all([
        client.stats(),
        client.metrics()
      ]);

      const newStats = {
        total: metrics.total_pushed || 0,
        completed: metrics.total_completed || 0,
        processing: stats.data?.processing || 0,
        failed: metrics.total_failed || 0,
        queued: stats.data?.queued || 0
      };

      // Calculate throughput
      const timeDelta = 0.5; // 500ms
      state.throughput = {
        push: Math.round((newStats.total - state.lastStats.total) / timeDelta),
        complete: Math.round((newStats.completed - state.lastStats.completed) / timeDelta)
      };

      // Track deltas for animations
      const deltas = {
        total: newStats.total - state.lastStats.total,
        completed: newStats.completed - state.lastStats.completed,
        processing: newStats.processing - state.lastStats.processing,
        failed: newStats.failed - state.lastStats.failed,
        queued: newStats.queued - state.lastStats.queued
      };

      // Flash stats that changed
      if (deltas.total > 0) flashStat('total');
      if (deltas.completed > 0) flashStat('completed');
      if (deltas.failed > 0) flashStat('failed');

      state.lastStats = newStats;

      // Animate to new values
      animateStats(newStats);

      // Update throughput display
      updateThroughputDisplay();

      // Update throughput history for chart
      state.throughputHistory.push({
        time: Date.now(),
        push: state.throughput.push,
        complete: state.throughput.complete
      });
      if (state.throughputHistory.length > 60) state.throughputHistory.shift();
      updateThroughputChart();

    } catch (error) {
      // Silently fail
    }
  };

  pollStats();
  state.statsInterval = setInterval(pollStats, 500); // Poll every 500ms for real-time feel
}

function stopRealTimePolling() {
  if (state.statsInterval) {
    clearInterval(state.statsInterval);
    state.statsInterval = null;
  }
  if (state.ws) {
    state.ws.close();
    state.ws = null;
  }
  if (state.sse) {
    state.sse.close();
    state.sse = null;
  }
}

// ============== Animation: Smooth Number Counters ==============
function animateStats(target) {
  const duration = 300;
  const startTime = performance.now();
  const start = { ...state.animatedStats };

  const animate = (currentTime) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);

    state.animatedStats = {
      total: Math.round(start.total + (target.total - start.total) * easeOutQuart),
      completed: Math.round(start.completed + (target.completed - start.completed) * easeOutQuart),
      processing: Math.round(start.processing + (target.processing - start.processing) * easeOutQuart),
      failed: Math.round(start.failed + (target.failed - start.failed) * easeOutQuart),
      queued: Math.round(start.queued + (target.queued - start.queued) * easeOutQuart)
    };

    updateStatsDisplay();

    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  };

  requestAnimationFrame(animate);
}

function updateStatsDisplay() {
  const s = state.animatedStats;
  document.getElementById('stat-total').textContent = formatNumber(s.total);
  document.getElementById('stat-completed').textContent = formatNumber(s.completed);
  document.getElementById('stat-processing').textContent = formatNumber(s.processing);
  document.getElementById('stat-queued').textContent = formatNumber(s.queued);
  document.getElementById('stat-failed').textContent = formatNumber(s.failed);

  const rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0;
  document.getElementById('stat-success-rate').textContent = `${rate}%`;

  // Update progress bar
  const bar = document.getElementById('stat-total-bar');
  if (bar) bar.style.width = `${Math.min(rate, 100)}%`;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function flashStat(statName) {
  const el = document.getElementById(`stat-${statName}`);
  if (el) {
    el.classList.add('scale-110');
    setTimeout(() => el.classList.remove('scale-110'), 200);
  }

  // Add pulse to card
  const cards = {
    total: 'stat-card-pink',
    completed: 'stat-card-green',
    processing: 'stat-card-cyan',
    queued: 'stat-card-orange',
    failed: 'stat-card-red'
  };

  const cardClass = cards[statName];
  if (cardClass) {
    const card = document.querySelector(`.${cardClass}`);
    if (card) {
      card.classList.add('animate-pulse');
      setTimeout(() => card.classList.remove('animate-pulse'), 500);
    }
  }
}

// ============== Activity Feed ==============
function addActivity(type, message, data = null) {
  const activity = {
    type,
    message,
    data,
    time: new Date()
  };

  state.recentActivity.unshift(activity);
  if (state.recentActivity.length > 50) state.recentActivity.pop();

  updateActivityFeed();
}

function updateActivityFeed() {
  const container = document.getElementById('activity-feed');
  if (!container) return;

  const icons = {
    completed: { icon: 'fa-check-circle', color: 'text-green-400' },
    failed: { icon: 'fa-times-circle', color: 'text-red-400' },
    active: { icon: 'fa-spinner fa-spin', color: 'text-cyan-400' },
    waiting: { icon: 'fa-clock', color: 'text-orange-400' },
    progress: { icon: 'fa-tasks', color: 'text-purple-400' },
    system: { icon: 'fa-bolt', color: 'text-pink-400' }
  };

  container.innerHTML = state.recentActivity.slice(0, 15).map((a, i) => {
    const { icon, color } = icons[a.type] || icons.system;
    const time = a.time.toLocaleTimeString();
    const opacity = Math.max(0.3, 1 - (i * 0.05));

    return `
      <div class="activity-item flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-all" style="opacity: ${opacity}">
        <i class="fas ${icon} ${color} text-sm w-4"></i>
        <span class="flex-1 text-xs text-gray-300 truncate">${a.message}</span>
        <span class="text-xs text-gray-600">${time}</span>
      </div>
    `;
  }).join('');
}

// ============== Throughput Display ==============
function updateThroughputDisplay() {
  const pushEl = document.getElementById('throughput-push');
  const completeEl = document.getElementById('throughput-complete');

  if (pushEl) pushEl.textContent = `${state.throughput.push}/s`;
  if (completeEl) completeEl.textContent = `${state.throughput.complete}/s`;
}

function updateThroughputChart() {
  const canvas = document.getElementById('throughput-chart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  if (state.throughputHistory.length < 2) return;

  const maxVal = Math.max(
    ...state.throughputHistory.map(h => Math.max(h.push, h.complete)),
    10
  );

  const drawLine = (data, color) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    data.forEach((point, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - (point / maxVal) * height;

      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
  };

  drawLine(state.throughputHistory.map(h => h.push), '#ff00ff');
  drawLine(state.throughputHistory.map(h => h.complete), '#00ff88');
}

// ============== UI Helpers ==============
function log(message, type = 'info') {
  const output = document.getElementById('log-output');
  if (!output) return;

  const time = new Date().toLocaleTimeString();
  const colors = {
    info: 'text-blue-400',
    success: 'text-green-400',
    error: 'text-red-400',
    warning: 'text-yellow-400',
    system: 'text-purple-400'
  };

  const entry = document.createElement('div');
  entry.className = `log-entry ${colors[type] || 'text-gray-400'}`;
  entry.innerHTML = `<span class="text-gray-500">[${time}]</span> ${message}`;
  output.appendChild(entry);
  output.scrollTop = output.scrollHeight;

  // Add to activity if important
  if (type === 'success' || type === 'error') {
    addActivity(type === 'success' ? 'completed' : 'failed', message);
  }
}

function clearLogs() {
  const output = document.getElementById('log-output');
  if (output) output.innerHTML = '<div class="text-gray-500">Logs cleared.</div>';
}

function showResult(data) {
  const output = document.getElementById('result-output');
  if (output) output.textContent = JSON.stringify(data, null, 2);
}

function updateWorkerStats() {
  document.getElementById('worker-processed').textContent = state.workerStats.processed;
  document.getElementById('worker-failed').textContent = state.workerStats.failed;
  document.getElementById('worker-active').textContent = state.workerStats.active;
}

function setConnectionStatus(connected) {
  state.connected = connected;
  const dot = document.getElementById('status-dot');
  const ring = document.getElementById('status-ring');
  const text = document.getElementById('status-text');

  if (connected) {
    dot.className = 'block w-3 h-3 rounded-full status-connected';
    ring.className = 'absolute inset-0 w-3 h-3 rounded-full status-connected animate-ping';
    text.textContent = 'LIVE';
    text.className = 'text-sm font-medium font-cyber text-green-400';
  } else {
    dot.className = 'block w-3 h-3 rounded-full status-disconnected';
    ring.className = 'absolute inset-0 w-3 h-3 rounded-full status-disconnected';
    text.textContent = 'OFFLINE';
    text.className = 'text-sm font-medium font-cyber text-red-400';
  }
}

// ============== Tab Switching ==============
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active', 'border-primary-500');
    btn.classList.add('border-transparent');
  });

  document.getElementById(`tab-${tabId}`).classList.add('active');
  const activeBtn = document.querySelector(`[data-tab="${tabId}"]`);
  activeBtn.classList.add('active', 'border-primary-500');
  activeBtn.classList.remove('border-transparent');
}

// ============== Settings Modal ==============
function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

// ============== Connection ==============
async function connect() {
  const host = document.getElementById('settings-host').value;
  const port = parseInt(document.getElementById('settings-port').value);
  const token = document.getElementById('settings-token').value;

  state.host = host;
  state.port = port;
  state.token = token;

  client = new FlashQHttpClient(host, port, token);

  try {
    const health = await client.health();
    setConnectionStatus(true);
    log(`Connected to FlashQ at ${host}:${port}`, 'success');
    log(`Server status: ${health.status || 'healthy'}`, 'system');
    addActivity('system', `Connected to FlashQ server`);
    closeSettings();

    // Start real-time updates
    startRealTimePolling();
    connectWebSocket();

  } catch (error) {
    log(`Connection failed: ${error.message}`, 'error');
    setConnectionStatus(false);
  }
}

function disconnect() {
  client = null;
  setConnectionStatus(false);
  stopRealTimePolling();
  log('Disconnected from FlashQ', 'warning');
  addActivity('system', 'Disconnected');
  closeSettings();
}

// ============== Push Operations ==============
async function pushJobs() {
  if (!checkConnection()) return;

  const queue = document.getElementById('push-queue').value;
  const count = parseInt(document.getElementById('push-count').value) || 1;
  let dataStr = document.getElementById('push-data').value;
  const priority = parseInt(document.getElementById('push-priority').value) || 0;
  const delay = parseInt(document.getElementById('push-delay').value) || 0;
  const maxAttempts = parseInt(document.getElementById('push-attempts').value) || 3;
  const timeout = parseInt(document.getElementById('push-timeout').value) || 30000;
  const jobId = document.getElementById('push-jobid').value || undefined;
  const uniqueKey = document.getElementById('push-unique').value || undefined;

  dataStr = dataStr.replace('${Date.now()}', Date.now().toString());

  try {
    const data = JSON.parse(dataStr);
    const options = { priority, delay, max_attempts: maxAttempts, timeout };
    if (jobId) options.jobId = jobId;
    if (uniqueKey) options.unique_key = uniqueKey;

    if (count === 1) {
      const result = await client.push(queue, data, options);
      log(`Pushed job #${result.data?.id || result.id} to "${queue}"`, 'success');
      addActivity('waiting', `Job #${result.data?.id || result.id} pushed to ${queue}`);
      showResult(result);
    } else {
      const jobs = Array(count).fill().map((_, i) => ({ data: { ...data, index: i }, ...options }));
      const result = await client.pushBatch(queue, jobs);
      log(`Batch pushed ${result.data?.ids?.length || count} jobs to "${queue}"`, 'success');
      addActivity('waiting', `${count} jobs pushed to ${queue}`);
      showResult(result);
    }
  } catch (error) {
    log(`Push failed: ${error.message}`, 'error');
  }
}

async function pushBatch() {
  if (!checkConnection()) return;
  const queue = document.getElementById('push-queue').value;

  try {
    const jobs = Array(100).fill().map((_, i) => ({
      data: { index: i, timestamp: Date.now() },
      priority: Math.floor(Math.random() * 10)
    }));

    const result = await client.pushBatch(queue, jobs);
    log(`Batch pushed 100 jobs to "${queue}"`, 'success');
    addActivity('waiting', `100 jobs batch pushed`);
    showResult(result);
  } catch (error) {
    log(`Batch push failed: ${error.message}`, 'error');
  }
}

async function pushFlow() {
  if (!checkConnection()) return;
  const queue = document.getElementById('push-queue').value;

  try {
    const parent = await client.push(queue, { type: 'parent', step: 'init' });
    const parentId = parent.data?.id || parent.id;
    log(`Created flow parent #${parentId}`, 'info');

    const child1 = await client.push(queue, { type: 'child', step: 1 }, { depends_on: [parentId] });
    const child1Id = child1.data?.id || child1.id;
    const child2 = await client.push(queue, { type: 'child', step: 2 }, { depends_on: [parentId] });
    const child2Id = child2.data?.id || child2.id;
    const child3 = await client.push(queue, { type: 'child', step: 3 }, { depends_on: [child1Id, child2Id] });
    const child3Id = child3.data?.id || child3.id;

    log(`Created flow: Parent #${parentId} -> Children #${child1Id}, #${child2Id} -> Final #${child3Id}`, 'success');
    addActivity('system', `Flow created: ${parentId} -> ${child1Id}, ${child2Id} -> ${child3Id}`);
    showResult({ parent: parentId, children: [child1Id, child2Id], final: child3Id });
  } catch (error) {
    log(`Flow creation failed: ${error.message}`, 'error');
  }
}

async function pushMany(count) {
  if (!checkConnection()) return;
  const queue = document.getElementById('push-queue').value;

  try {
    const batchSize = 100;
    const batches = Math.ceil(count / batchSize);
    let totalPushed = 0;

    log(`Starting push of ${count} jobs...`, 'info');
    addActivity('system', `Pushing ${count} jobs...`);

    for (let b = 0; b < batches; b++) {
      const size = Math.min(batchSize, count - totalPushed);
      const jobs = Array(size).fill().map((_, i) => ({
        data: { index: totalPushed + i, timestamp: Date.now() }
      }));

      await client.pushBatch(queue, jobs);
      totalPushed += size;

      // Update progress
      if (b % 10 === 0 || b === batches - 1) {
        log(`Pushed ${totalPushed}/${count} jobs...`, 'info');
      }
    }

    log(`Pushed ${totalPushed} jobs to "${queue}"`, 'success');
    addActivity('system', `${totalPushed} jobs pushed successfully`);
  } catch (error) {
    log(`Push many failed: ${error.message}`, 'error');
  }
}

// ============== Worker Operations ==============
async function startWorker() {
  if (!checkConnection()) return;
  if (state.workerRunning) return;

  const queue = document.getElementById('worker-queue').value;
  const concurrency = parseInt(document.getElementById('worker-concurrency').value) || 1;
  const behavior = document.getElementById('worker-behavior').value;

  state.workerRunning = true;
  state.workerStats = { processed: 0, failed: 0, active: 0 };

  document.getElementById('btn-start-worker').disabled = true;
  document.getElementById('btn-start-worker').style.opacity = '0.5';
  document.getElementById('btn-stop-worker').disabled = false;
  document.getElementById('btn-stop-worker').style.opacity = '1';

  log(`Worker started for "${queue}" (concurrency: ${concurrency})`, 'success');
  addActivity('system', `Worker started: ${queue} x${concurrency}`);

  const processJob = async () => {
    if (!state.workerRunning || state.workerStats.active >= concurrency) return;

    try {
      state.workerStats.active++;
      updateWorkerStats();

      const job = await client.pull(queue, 500);

      if (job && job.id) {
        addActivity('active', `Processing job #${job.id}`);

        let shouldFail = false;
        let delay = 0;

        switch (behavior) {
          case 'instant': delay = 0; break;
          case 'fast': delay = 100 + Math.random() * 400; break;
          case 'medium': delay = 500 + Math.random() * 1500; break;
          case 'slow': delay = 2000 + Math.random() * 3000; break;
          case 'random-fail':
            delay = 100 + Math.random() * 400;
            shouldFail = Math.random() < 0.3;
            break;
          case 'progress':
            for (let p = 0; p <= 100; p += 20) {
              await client.progress(job.id, p, `Processing ${p}%`);
              await new Promise(r => setTimeout(r, 200));
            }
            break;
        }

        if (delay > 0) await new Promise(r => setTimeout(r, delay));

        if (shouldFail) {
          await client.fail(job.id, 'Simulated random failure');
          state.workerStats.failed++;
          addActivity('failed', `Job #${job.id} failed`);
        } else {
          await client.ack(job.id, { processed: true, timestamp: Date.now() });
          state.workerStats.processed++;
          addActivity('completed', `Job #${job.id} completed`);
        }
      }
    } catch (error) {
      // Timeout or no jobs
    } finally {
      state.workerStats.active--;
      updateWorkerStats();
    }
  };

  const runLoop = async () => {
    while (state.workerRunning) {
      const promises = [];
      for (let i = 0; i < concurrency - state.workerStats.active; i++) {
        promises.push(processJob());
      }
      await Promise.all(promises);
      await new Promise(r => setTimeout(r, 50));
    }
  };

  runLoop();
}

function stopWorker() {
  state.workerRunning = false;

  document.getElementById('btn-start-worker').disabled = false;
  document.getElementById('btn-start-worker').style.opacity = '1';
  document.getElementById('btn-stop-worker').disabled = true;
  document.getElementById('btn-stop-worker').style.opacity = '0.5';

  log('Worker stopped', 'warning');
  addActivity('system', 'Worker stopped');
}

// ============== Queue Operations ==============
async function pauseQueue() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  try {
    await client.pause(queue);
    log(`Queue "${queue}" paused`, 'warning');
    addActivity('system', `Queue ${queue} paused`);
  } catch (error) {
    log(`Pause failed: ${error.message}`, 'error');
  }
}

async function resumeQueue() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  try {
    await client.resume(queue);
    log(`Queue "${queue}" resumed`, 'success');
    addActivity('system', `Queue ${queue} resumed`);
  } catch (error) {
    log(`Resume failed: ${error.message}`, 'error');
  }
}

async function drainQueue() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  if (!confirm(`Drain all waiting jobs from "${queue}"?`)) return;
  try {
    const result = await client.drain(queue);
    log(`Queue "${queue}" drained: ${result.removed || 0} jobs removed`, 'warning');
    addActivity('system', `Queue ${queue} drained`);
    showResult(result);
  } catch (error) {
    log(`Drain failed: ${error.message}`, 'error');
  }
}

async function obliterateQueue() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  if (!confirm(`OBLITERATE all data from "${queue}"? This cannot be undone!`)) return;
  try {
    await client.obliterate(queue);
    log(`Queue "${queue}" obliterated`, 'error');
    addActivity('system', `Queue ${queue} OBLITERATED`);
  } catch (error) {
    log(`Obliterate failed: ${error.message}`, 'error');
  }
}

async function setRateLimit() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  const limit = parseInt(document.getElementById('queue-ratelimit').value);
  try {
    await client.setRateLimit(queue, limit);
    log(`Rate limit set to ${limit}/sec for "${queue}"`, 'success');
  } catch (error) {
    log(`Set rate limit failed: ${error.message}`, 'error');
  }
}

async function clearRateLimit() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  try {
    await client.clearRateLimit(queue);
    log(`Rate limit cleared for "${queue}"`, 'success');
  } catch (error) {
    log(`Clear rate limit failed: ${error.message}`, 'error');
  }
}

async function setConcurrency() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  const limit = parseInt(document.getElementById('queue-concurrency').value);
  try {
    await client.setConcurrency(queue, limit);
    log(`Concurrency limit set to ${limit} for "${queue}"`, 'success');
  } catch (error) {
    log(`Set concurrency failed: ${error.message}`, 'error');
  }
}

async function clearConcurrency() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  try {
    await client.clearConcurrency(queue);
    log(`Concurrency limit cleared for "${queue}"`, 'success');
  } catch (error) {
    log(`Clear concurrency failed: ${error.message}`, 'error');
  }
}

async function listQueues() {
  if (!checkConnection()) return;
  try {
    const result = await client.listQueues();
    const queues = result.data || result.queues || [];
    log(`Found ${queues.length} queues`, 'info');
    showResult(result);
  } catch (error) {
    log(`List queues failed: ${error.message}`, 'error');
  }
}

async function getStats() {
  if (!checkConnection()) return;
  try {
    const result = await client.stats();
    log('Retrieved queue stats', 'info');
    showResult(result);
  } catch (error) {
    log(`Get stats failed: ${error.message}`, 'error');
  }
}

async function getMetrics() {
  if (!checkConnection()) return;
  try {
    const result = await client.metrics();
    log('Retrieved metrics', 'info');
    showResult(result);
  } catch (error) {
    log(`Get metrics failed: ${error.message}`, 'error');
  }
}

async function getDlq() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  try {
    const result = await client.getDlq(queue, 20);
    const jobs = result.data || result.jobs || [];
    log(`DLQ has ${jobs.length} jobs`, 'info');
    showResult(result);
  } catch (error) {
    log(`Get DLQ failed: ${error.message}`, 'error');
  }
}

async function retryAllDlq() {
  if (!checkConnection()) return;
  const queue = document.getElementById('queue-name').value;
  try {
    const result = await client.retryDlq(queue);
    log(`Retried ${result.retried || 0} jobs from DLQ`, 'success');
    showResult(result);
  } catch (error) {
    log(`Retry DLQ failed: ${error.message}`, 'error');
  }
}

// ============== Advanced Operations ==============
async function getJob() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('job-id').value);
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }
  try {
    const result = await client.getJob(jobId);
    log(`Retrieved job #${jobId}`, 'info');
    showResult(result);
  } catch (error) {
    log(`Get job failed: ${error.message}`, 'error');
  }
}

async function getJobByCustomId() {
  if (!checkConnection()) return;
  const customId = document.getElementById('custom-job-id').value;
  if (!customId) { log('Please enter a custom job ID', 'warning'); return; }
  try {
    const result = await client.getJobByCustomId(customId);
    log(`Found job with custom ID "${customId}"`, 'info');
    showResult(result);
  } catch (error) {
    log(`Get job by custom ID failed: ${error.message}`, 'error');
  }
}

async function getJobState() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('job-id').value);
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }
  try {
    const result = await client.getState(jobId);
    log(`Job #${jobId} state: ${result.data?.state}`, 'info');
    showResult(result);
  } catch (error) {
    log(`Get state failed: ${error.message}`, 'error');
  }
}

async function cancelJob() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('job-id').value);
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }
  try {
    await client.cancel(jobId);
    log(`Job #${jobId} cancelled`, 'warning');
    addActivity('system', `Job #${jobId} cancelled`);
  } catch (error) {
    log(`Cancel failed: ${error.message}`, 'error');
  }
}

async function promoteJob() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('job-id').value);
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }
  try {
    await client.promote(jobId);
    log(`Job #${jobId} promoted to waiting`, 'success');
  } catch (error) {
    log(`Promote failed: ${error.message}`, 'error');
  }
}

async function discardJob() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('job-id').value);
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }
  try {
    await client.discard(jobId);
    log(`Job #${jobId} discarded to DLQ`, 'warning');
    addActivity('failed', `Job #${jobId} discarded`);
  } catch (error) {
    log(`Discard failed: ${error.message}`, 'error');
  }
}

async function updateProgress() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('progress-job-id').value);
  const progress = parseInt(document.getElementById('progress-value').value);
  const message = document.getElementById('progress-message').value;
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }
  try {
    await client.progress(jobId, progress, message);
    log(`Job #${jobId} progress updated to ${progress}%`, 'info');
    addActivity('progress', `Job #${jobId}: ${progress}%`);
  } catch (error) {
    log(`Update progress failed: ${error.message}`, 'error');
  }
}

async function getProgress() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('progress-job-id').value);
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }
  try {
    const result = await client.getProgress(jobId);
    log(`Job #${jobId} progress: ${result.progress || 0}%`, 'info');
    showResult(result);
  } catch (error) {
    log(`Get progress failed: ${error.message}`, 'error');
  }
}

async function waitForJob() {
  if (!checkConnection()) return;
  const jobId = parseInt(document.getElementById('wait-job-id').value);
  const timeout = parseInt(document.getElementById('wait-timeout').value);
  if (!jobId) { log('Please enter a job ID', 'warning'); return; }

  log(`Waiting for job #${jobId} to complete (timeout: ${timeout}ms)...`, 'info');
  try {
    const result = await client.finished(jobId, timeout);
    log(`Job #${jobId} finished!`, 'success');
    showResult(result);
  } catch (error) {
    log(`Wait failed: ${error.message}`, 'error');
  }
}

// ============== Cron Operations ==============
async function addCron() {
  if (!checkConnection()) return;
  const name = document.getElementById('cron-name').value;
  const queue = document.getElementById('cron-queue').value;
  const schedule = document.getElementById('cron-schedule').value;
  let data = {};
  try {
    data = JSON.parse(document.getElementById('cron-data').value);
  } catch {
    log('Invalid JSON data', 'error');
    return;
  }
  try {
    await client.addCron(name, { queue, schedule, data });
    log(`Cron job "${name}" created`, 'success');
    addActivity('system', `Cron "${name}" created`);
    listCrons();
  } catch (error) {
    log(`Add cron failed: ${error.message}`, 'error');
  }
}

async function listCrons() {
  if (!checkConnection()) return;
  try {
    const result = await client.listCrons();
    const container = document.getElementById('cron-list');
    const crons = result.data || result.crons || [];

    if (crons.length === 0) {
      container.innerHTML = '<p class="text-gray-400 text-center py-4 font-cyber">No cron jobs. Click "LIST CRONS" to refresh.</p>';
      return;
    }

    container.innerHTML = crons.map(cron => `
      <div class="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-orange-500/20">
        <div>
          <div class="font-medium font-cyber text-orange-300">${cron.name}</div>
          <div class="text-xs text-gray-400 font-mono">${cron.schedule} → ${cron.queue}</div>
        </div>
        <button onclick="deleteCron('${cron.name}')" class="text-red-400 hover:text-red-300 transition-colors">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `).join('');

    log(`Found ${crons.length} cron jobs`, 'info');
  } catch (error) {
    log(`List crons failed: ${error.message}`, 'error');
  }
}

async function deleteCron(name) {
  if (!checkConnection()) return;
  try {
    await client.deleteCron(name);
    log(`Cron job "${name}" deleted`, 'warning');
    addActivity('system', `Cron "${name}" deleted`);
    listCrons();
  } catch (error) {
    log(`Delete cron failed: ${error.message}`, 'error');
  }
}

// ============== Helpers ==============
function checkConnection() {
  if (!client || !state.connected) {
    log('Not connected. Click settings to connect.', 'error');
    openSettings();
    return false;
  }
  return true;
}

// ============== Initialize ==============
document.addEventListener('DOMContentLoaded', () => {
  log('FlashQ Real-Time Simulator loaded', 'system');
  log('Connecting to server...', 'system');
  addActivity('system', 'Simulator initialized');

  // Auto-connect on load
  setTimeout(() => {
    connect();
  }, 500);
});
