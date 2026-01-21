// ============================================================================
// FlashQ Dashboard - Main Controller (Enterprise Edition)
// ============================================================================

(function() {
    'use strict';

    const { formatTime, formatNumber, escapeHtml, getBadgeClass } = DashboardUtils;
    const API = DashboardAPI;
    const Charts = DashboardCharts;
    const Settings = DashboardSettings;

    // ========================================================================
    // State
    // ========================================================================

    const state = {
        currentSection: 'overview',
        stats: { queued: 0, processing: 0, delayed: 0, dlq: 0 },
        metrics: { total_pushed: 0, total_completed: 0, total_failed: 0, jobs_per_second: 0 },
        queues: [],
        jobs: [],
        crons: [],
        workers: [],
        metricsHistory: [],
        settings: {},
        connected: false,
        selectedJobs: new Set(),
        jobPage: 0,
        chartRange: '5m'
    };

    let dashboardSocket = null;
    let reconnectTimeout = null;
    let updateInterval = null;

    // ========================================================================
    // WebSocket Real-time Connection
    // ========================================================================

    function connectWebSocket() {
        if (dashboardSocket && dashboardSocket.readyState === WebSocket.OPEN) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/dashboard`;

        try {
            dashboardSocket = new WebSocket(wsUrl);

            dashboardSocket.onopen = () => {
                state.connected = true;
                updateConnectionUI();
            };

            dashboardSocket.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    if (data.stats) {
                        state.stats = data.stats;
                        updateStatsUI();
                    }
                    if (data.metrics) {
                        state.metrics = data.metrics;
                        updateMetricsUI();
                    }
                    if (data.queues) {
                        state.queues = data.queues;
                        updateQueuesUI();
                        updateQueueFilterOptions();
                    }
                    if (data.workers) {
                        state.workers = data.workers;
                        updateWorkersUI();
                    }
                    if (data.metrics_history) {
                        state.metricsHistory = data.metrics_history;
                        Charts.updateCharts(state.metricsHistory, state.chartRange);
                    }
                } catch (err) {
                    console.error('WebSocket message error:', err);
                }
            };

            dashboardSocket.onclose = () => {
                state.connected = false;
                updateConnectionUI();
                reconnectTimeout = setTimeout(connectWebSocket, 2000);
            };

            dashboardSocket.onerror = () => {
                state.connected = false;
                updateConnectionUI();
            };
        } catch (e) {
            console.error('WebSocket connection error:', e);
            startPolling();
        }
    }

    function updateConnectionUI() {
        const statusDot = document.getElementById('connection-status');
        const statusText = document.getElementById('connection-text');

        if (state.connected) {
            statusDot.className = 'status-dot';
            statusText.textContent = 'Connected';
            statusText.className = 'status-text';
        } else {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'Disconnected';
            statusText.className = 'status-text offline';
        }
    }

    // ========================================================================
    // Polling Fallback
    // ========================================================================

    function startPolling() {
        if (updateInterval) return;
        updateInterval = setInterval(fetchAllData, 2000);
        fetchAllData();
    }

    async function fetchAllData() {
        try {
            const [stats, metrics, queues, workers, crons, metricsHistory, settings] = await Promise.all([
                API.fetchStats(),
                API.fetchMetrics(),
                API.fetchQueues(),
                API.fetchWorkers(),
                API.fetchCrons(),
                API.fetchMetricsHistory(),
                API.fetchSettings()
            ]);

            if (stats) {
                state.stats = stats;
                updateStatsUI();
            }
            if (metrics) {
                state.metrics = metrics;
                updateMetricsUI();
            }
            if (queues) {
                state.queues = queues;
                updateQueuesUI();
                updateQueueFilterOptions();
            }
            if (workers) {
                state.workers = workers;
                updateWorkersUI();
            }
            if (crons) {
                state.crons = crons;
                updateCronsUI();
            }
            if (metricsHistory) {
                state.metricsHistory = metricsHistory;
                Charts.updateCharts(state.metricsHistory, state.chartRange);
            }
            if (settings) {
                state.settings = settings;
                Settings.updateUI(settings);
                updateHeaderInfo(settings);
            }

            state.connected = true;
            updateConnectionUI();
        } catch (e) {
            state.connected = false;
            updateConnectionUI();
        }
    }

    // ========================================================================
    // UI Updates
    // ========================================================================

    function updateHeaderInfo(settings) {
        if (settings.tcp_port) document.getElementById('header-tcp').textContent = settings.tcp_port;
        if (settings.http_port) document.getElementById('header-http').textContent = settings.http_port;
        if (settings.version) document.getElementById('header-version').textContent = settings.version;

        // Update uptime
        if (settings.uptime_seconds) {
            const hours = Math.floor(settings.uptime_seconds / 3600);
            const mins = Math.floor((settings.uptime_seconds % 3600) / 60);
            const secs = settings.uptime_seconds % 60;
            document.getElementById('sidebar-uptime').textContent =
                `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
    }

    function updateStatsUI() {
        const total = state.stats.queued + state.stats.processing + state.stats.delayed + state.stats.dlq;

        document.getElementById('stat-queued').textContent = formatNumber(state.stats.queued);
        document.getElementById('stat-processing').textContent = formatNumber(state.stats.processing);
        document.getElementById('stat-delayed').textContent = formatNumber(state.stats.delayed);
        document.getElementById('stat-dlq').textContent = formatNumber(state.stats.dlq);

        // Update bars
        if (total > 0) {
            document.getElementById('bar-queued').style.width = `${(state.stats.queued / total) * 100}%`;
            document.getElementById('bar-processing').style.width = `${(state.stats.processing / total) * 100}%`;
            document.getElementById('bar-delayed').style.width = `${(state.stats.delayed / total) * 100}%`;
            document.getElementById('bar-dlq').style.width = `${(state.stats.dlq / total) * 100}%`;
        }
    }

    function updateMetricsUI() {
        document.getElementById('metric-pushed').textContent = formatNumber(state.metrics.total_pushed || 0);
        document.getElementById('metric-completed').textContent = formatNumber(state.metrics.total_completed || 0);
        document.getElementById('metric-failed').textContent = formatNumber(state.metrics.total_failed || 0);
        document.getElementById('metric-throughput').textContent = `${formatNumber(state.metrics.jobs_per_second || 0)}/s`;
    }

    function updateQueuesUI() {
        const overviewTable = document.getElementById('overview-queues');
        const queuesTable = document.getElementById('queues-table');

        if (state.queues.length === 0) {
            const emptyRow = '<tr><td colspan="8" class="text-center" style="color: var(--text-muted); padding: 2rem;">No queues found</td></tr>';
            if (overviewTable) overviewTable.innerHTML = emptyRow;
            if (queuesTable) queuesTable.innerHTML = emptyRow;
            return;
        }

        const renderRow = (q, extended = false) => {
            const status = q.paused ?
                '<span class="badge badge-paused">Paused</span>' :
                '<span class="badge badge-active">Active</span>';

            let row = `
                <tr>
                    <td class="mono">${escapeHtml(q.name)}</td>
                    <td class="text-right mono">${formatNumber(q.pending || 0)}</td>
                    <td class="text-right mono">${formatNumber(q.processing || 0)}</td>
                    <td class="text-right mono">${formatNumber(q.dlq || 0)}</td>`;

            if (extended) {
                row += `
                    <td class="text-right mono">${q.rate_limit || '-'}</td>
                    <td class="text-right mono">${q.concurrency || '-'}</td>`;
            }

            row += `
                    <td>${status}</td>
                    <td class="text-right">
                        <button class="btn btn-ghost btn-sm" onclick="window.dashboard.togglePause('${escapeHtml(q.name)}', ${q.paused})">${q.paused ? 'Resume' : 'Pause'}</button>
                        ${q.dlq > 0 ? `<button class="btn btn-ghost btn-sm" onclick="window.dashboard.retryDlq('${escapeHtml(q.name)}')">Retry DLQ</button>` : ''}
                    </td>
                </tr>`;
            return row;
        };

        if (overviewTable) {
            overviewTable.innerHTML = state.queues.slice(0, 5).map(q => renderRow(q, false)).join('');
        }
        if (queuesTable) {
            queuesTable.innerHTML = state.queues.map(q => renderRow(q, true)).join('');
        }
    }

    function updateQueueFilterOptions() {
        const select = document.getElementById('job-queue-filter');
        if (!select) return;

        const currentValue = select.value;
        select.innerHTML = '<option value="">All Queues</option>' +
            state.queues.map(q => `<option value="${escapeHtml(q.name)}">${escapeHtml(q.name)}</option>`).join('');
        select.value = currentValue;
    }

    function updateCronsUI() {
        const table = document.getElementById('crons-table');
        if (!table) return;

        if (state.crons.length === 0) {
            table.innerHTML = '<tr><td colspan="7" class="text-center" style="color: var(--text-muted); padding: 2rem;">No cron jobs configured</td></tr>';
            return;
        }

        table.innerHTML = state.crons.map(c => `
            <tr>
                <td class="mono">${escapeHtml(c.name)}</td>
                <td class="mono">${escapeHtml(c.queue)}</td>
                <td class="mono">${escapeHtml(c.schedule)}</td>
                <td class="text-right">${c.priority || 0}</td>
                <td>${c.next_run ? formatTime(c.next_run) : '-'}</td>
                <td class="mono" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(JSON.stringify(c.data || {}))}</td>
                <td class="text-right">
                    <button class="btn btn-danger btn-sm" onclick="window.dashboard.deleteCron('${escapeHtml(c.name)}')">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    function updateWorkersUI() {
        const table = document.getElementById('workers-table');
        if (!table) return;

        if (state.workers.length === 0) {
            table.innerHTML = '<tr><td colspan="6" class="text-center" style="color: var(--text-muted); padding: 2rem;">No workers connected</td></tr>';
            return;
        }

        const now = Date.now();
        table.innerHTML = state.workers.map(w => {
            const lastHeartbeat = w.last_heartbeat ? new Date(w.last_heartbeat).getTime() : 0;
            const isOnline = (now - lastHeartbeat) < 30000;

            return `
                <tr>
                    <td class="mono">${escapeHtml(w.id || w.worker_id)}</td>
                    <td>${(w.queues || []).map(q => `<span class="badge badge-waiting">${escapeHtml(q)}</span>`).join(' ')}</td>
                    <td class="text-right">${w.concurrency || '-'}</td>
                    <td class="text-right mono">${formatNumber(w.jobs_processed || 0)}</td>
                    <td>${w.last_heartbeat ? formatTime(w.last_heartbeat) : '-'}</td>
                    <td>${isOnline ? '<span class="badge badge-active">Online</span>' : '<span class="badge badge-failed">Offline</span>'}</td>
                </tr>
            `;
        }).join('');
    }

    function updateJobsUI() {
        const table = document.getElementById('jobs-table');
        if (!table) return;

        if (state.jobs.length === 0) {
            table.innerHTML = '<tr><td colspan="8" class="text-center" style="color: var(--text-muted); padding: 2rem;">No jobs found</td></tr>';
            return;
        }

        table.innerHTML = state.jobs.map(j => {
            const stateClass = `badge-${j.state || 'waiting'}`;
            const isSelected = state.selectedJobs.has(j.id);
            return `
                <tr>
                    <td><input type="checkbox" ${isSelected ? 'checked' : ''} onchange="window.dashboard.toggleJobSelection(${j.id})"></td>
                    <td class="mono">${j.id}</td>
                    <td class="mono">${escapeHtml(j.queue)}</td>
                    <td><span class="badge ${stateClass}">${j.state || 'waiting'}</span></td>
                    <td class="text-right">${j.priority || 0}</td>
                    <td class="text-right">${j.attempts || 0}/${j.max_attempts || 3}</td>
                    <td>${formatTime(j.created_at)}</td>
                    <td class="text-right">
                        <button class="btn btn-ghost btn-sm" onclick="window.dashboard.showJobDetail(${j.id})">View</button>
                        ${j.state === 'waiting' || j.state === 'delayed' ? `<button class="btn btn-ghost btn-sm" onclick="window.dashboard.cancelJob(${j.id})">Cancel</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        document.getElementById('jobs-count').textContent = `${state.jobs.length} jobs`;
        document.getElementById('page-info').textContent = `Page ${state.jobPage + 1}`;
    }

    // ========================================================================
    // Navigation
    // ========================================================================

    function showSection(sectionId) {
        state.currentSection = sectionId;

        // Update nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.section === sectionId);
        });

        // Update sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.toggle('active', section.id === `section-${sectionId}`);
        });

        // Update page title
        const titles = {
            overview: ['Overview', 'Real-time system monitoring'],
            queues: ['Queues', 'Manage your job queues'],
            jobs: ['Jobs', 'Browse and manage jobs'],
            analytics: ['Analytics', 'Performance metrics and charts'],
            crons: ['Cron Jobs', 'Scheduled recurring jobs'],
            workers: ['Workers', 'Connected worker instances'],
            settings: ['Settings', 'System configuration']
        };

        const [title, subtitle] = titles[sectionId] || ['Dashboard', ''];
        document.getElementById('page-title').textContent = title;
        document.getElementById('page-subtitle').textContent = subtitle;

        // Load section-specific data
        if (sectionId === 'jobs') {
            searchJobs();
        } else if (sectionId === 'crons') {
            fetchCrons();
        } else if (sectionId === 'analytics') {
            Charts.initAnalyticsCharts();
            Charts.updateAnalyticsCharts(state.metricsHistory);
        }
    }

    // ========================================================================
    // Jobs
    // ========================================================================

    async function searchJobs() {
        const searchId = document.getElementById('job-search')?.value?.trim();
        const queue = document.getElementById('job-queue-filter')?.value;
        const jobState = document.getElementById('job-state-filter')?.value;

        const jobs = await API.fetchJobs({
            search: searchId,
            queue: queue,
            state: jobState,
            limit: 20,
            offset: state.jobPage * 20
        });

        state.jobs = jobs;
        updateJobsUI();
    }

    function clearJobFilters() {
        document.getElementById('job-search').value = '';
        document.getElementById('job-queue-filter').value = '';
        document.getElementById('job-state-filter').value = '';
        state.jobPage = 0;
        searchJobs();
    }

    function nextJobPage() {
        state.jobPage++;
        searchJobs();
    }

    function prevJobPage() {
        if (state.jobPage > 0) {
            state.jobPage--;
            searchJobs();
        }
    }

    // ========================================================================
    // Crons
    // ========================================================================

    async function fetchCrons() {
        state.crons = await API.fetchCrons();
        updateCronsUI();
    }

    // ========================================================================
    // Charts
    // ========================================================================

    function setChartRange(range) {
        state.chartRange = range;
        document.querySelectorAll('.range-btn').forEach(btn => {
            btn.classList.toggle('active', btn.id === `range-${range}`);
        });
        Charts.updateCharts(state.metricsHistory, range);
    }

    // ========================================================================
    // Initialize
    // ========================================================================

    function init() {
        // Setup navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', () => showSection(item.dataset.section));
        });

        // Initialize charts
        Charts.initCharts();

        // Start data fetching
        connectWebSocket();
        startPolling();

        // Initial data fetch
        fetchAllData();

        console.log('flashQ Dashboard initialized');
    }

    // ========================================================================
    // Public API
    // ========================================================================

    window.dashboard = {
        // Queue actions
        togglePause: async (name, isPaused) => {
            if (isPaused) {
                await API.resumeQueue(name);
            } else {
                await API.pauseQueue(name);
            }
            fetchAllData();
        },
        retryDlq: async (name) => {
            await API.retryDlq(name);
            fetchAllData();
        },

        // Job actions
        showJobDetail: async (id) => {
            const job = await API.fetchJobDetail(id);
            if (!job) return;

            const modal = document.getElementById('job-modal');
            const content = document.getElementById('job-modal-content');

            content.innerHTML = `
                <div class="form-grid cols-2">
                    <div class="info-card"><span class="info-label">ID</span><span class="info-value mono">${job.id}</span></div>
                    <div class="info-card"><span class="info-label">STATE</span><span class="info-value"><span class="badge badge-${job.state}">${job.state}</span></span></div>
                    <div class="info-card"><span class="info-label">QUEUE</span><span class="info-value mono">${escapeHtml(job.queue)}</span></div>
                    <div class="info-card"><span class="info-label">PRIORITY</span><span class="info-value">${job.priority || 0}</span></div>
                    <div class="info-card"><span class="info-label">ATTEMPTS</span><span class="info-value">${job.attempts || 0}/${job.max_attempts || 3}</span></div>
                    <div class="info-card"><span class="info-label">CREATED</span><span class="info-value">${formatTime(job.created_at)}</span></div>
                </div>
                <div class="form-group" style="margin-top: 1rem;">
                    <label class="form-label">DATA</label>
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; overflow: auto; max-height: 200px; font-family: var(--font-mono); font-size: 0.75rem;">${escapeHtml(JSON.stringify(job.data, null, 2))}</pre>
                </div>
                ${job.result ? `
                <div class="form-group">
                    <label class="form-label">RESULT</label>
                    <pre style="background: var(--bg-tertiary); padding: 1rem; border-radius: 6px; overflow: auto; max-height: 200px; font-family: var(--font-mono); font-size: 0.75rem;">${escapeHtml(JSON.stringify(job.result, null, 2))}</pre>
                </div>` : ''}
                ${job.error ? `
                <div class="form-group">
                    <label class="form-label" style="color: var(--red);">ERROR</label>
                    <pre style="background: var(--red-dim); padding: 1rem; border-radius: 6px; overflow: auto; max-height: 200px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--red);">${escapeHtml(job.error)}</pre>
                </div>` : ''}
            `;

            modal.classList.remove('hidden');
        },
        closeJobModal: () => {
            document.getElementById('job-modal').classList.add('hidden');
        },
        closeQueueModal: () => {
            document.getElementById('queue-modal').classList.add('hidden');
        },
        cancelJob: async (id) => {
            await API.cancelJob(id);
            searchJobs();
        },
        toggleJobSelection: (id) => {
            if (state.selectedJobs.has(id)) {
                state.selectedJobs.delete(id);
            } else {
                state.selectedJobs.add(id);
            }
            document.getElementById('selected-count').textContent = state.selectedJobs.size;
            document.getElementById('bulk-actions').classList.toggle('hidden', state.selectedJobs.size === 0);
        },
        bulkCancel: async () => {
            for (const id of state.selectedJobs) {
                await API.cancelJob(id);
            }
            state.selectedJobs.clear();
            searchJobs();
        },
        bulkRetry: async () => {
            for (const id of state.selectedJobs) {
                await API.retryJob(id);
            }
            state.selectedJobs.clear();
            searchJobs();
        },

        // Cron actions
        createCron: async () => {
            const name = document.getElementById('cron-name')?.value?.trim();
            const queue = document.getElementById('cron-queue')?.value?.trim();
            const schedule = document.getElementById('cron-schedule')?.value?.trim();
            const priority = parseInt(document.getElementById('cron-priority')?.value) || 0;
            const dataStr = document.getElementById('cron-data')?.value?.trim() || '{}';

            if (!name || !queue || !schedule) {
                alert('Name, Queue, and Schedule are required');
                return;
            }

            let data;
            try {
                data = JSON.parse(dataStr);
            } catch (e) {
                alert('Invalid JSON data');
                return;
            }

            const result = await API.createCron(name, { queue, schedule, priority, data });
            if (result.ok) {
                document.getElementById('cron-name').value = '';
                document.getElementById('cron-queue').value = '';
                document.getElementById('cron-schedule').value = '';
                document.getElementById('cron-data').value = '';
                fetchCrons();
            } else {
                alert('Failed to create cron: ' + (result.error || 'Unknown error'));
            }
        },
        deleteCron: async (name) => {
            if (!confirm(`Delete cron job "${name}"?`)) return;
            await API.deleteCron(name);
            fetchCrons();
        },

        // Settings actions from DashboardSettings
        ...Settings,

        // Additional settings actions for SQLite and S3
        saveSqliteSettings: async () => {
            const path = document.getElementById('sqlite-path')?.value || '';
            const synchronous = document.getElementById('sqlite-synchronous')?.value;
            const interval = document.getElementById('sqlite-snapshot-interval')?.value;
            const minChanges = document.getElementById('sqlite-min-changes')?.value;

            const envVars = [
                `DATA_PATH=${path || './flashq.db'}`,
                `SQLITE_SYNCHRONOUS=${synchronous === '1' ? 'true' : 'false'}`,
                `SNAPSHOT_INTERVAL=${interval || 60}`,
                `SNAPSHOT_MIN_CHANGES=${minChanges || 100}`
            ].join('\n');

            // Copy to clipboard
            try {
                await navigator.clipboard.writeText(envVars);
                Settings.showToast('Environment variables copied to clipboard. Update your .env file and restart the server.', 'success');
            } catch (e) {
                Settings.showToast('SQLite settings require server restart. Set these env vars:\n' + envVars, 'info');
            }
        },
        saveS3Settings: async () => {
            const enabled = document.getElementById('s3-enabled')?.checked;
            const compress = document.getElementById('s3-compress')?.checked;
            const endpoint = document.getElementById('s3-endpoint')?.value || '';
            const bucket = document.getElementById('s3-bucket')?.value || '';
            const region = document.getElementById('s3-region')?.value || 'auto';
            const accessKey = document.getElementById('s3-access-key')?.value || '';
            const secretKey = document.getElementById('s3-secret-key')?.value || '';
            const interval = document.getElementById('s3-interval')?.value || 300;
            const keepCount = document.getElementById('s3-keep-count')?.value || 24;

            const envVars = [
                `S3_BACKUP_ENABLED=${enabled ? 'true' : 'false'}`,
                `S3_BACKUP_COMPRESS=${compress ? 'true' : 'false'}`,
                `S3_ENDPOINT=${endpoint}`,
                `S3_BUCKET=${bucket}`,
                `S3_REGION=${region}`,
                accessKey ? `S3_ACCESS_KEY=${accessKey}` : '# S3_ACCESS_KEY=your-access-key',
                secretKey ? `S3_SECRET_KEY=${secretKey}` : '# S3_SECRET_KEY=your-secret-key',
                `S3_BACKUP_INTERVAL_SECS=${interval}`,
                `S3_BACKUP_KEEP_COUNT=${keepCount}`
            ].join('\n');

            try {
                await navigator.clipboard.writeText(envVars);
                Settings.showToast('Environment variables copied to clipboard. Update your .env file and restart the server.', 'success');
            } catch (e) {
                Settings.showToast('S3 settings require server restart. Update your environment variables.', 'info');
            }
        },
        testS3Connection: async () => {
            Settings.showToast('S3 connection test runs during server startup. Check server logs for backup status.', 'info');
        },
        triggerS3Backup: async () => {
            Settings.showToast('Triggering manual backup...', 'info');
            try {
                const result = await API.triggerS3Backup();
                if (result.ok) {
                    Settings.showToast('Backup completed successfully!', 'success');
                } else {
                    Settings.showToast('Backup failed: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                Settings.showToast('Backup failed: ' + e.message, 'error');
            }
        },
        showS3RestoreModal: async () => {
            Settings.showToast('Loading available backups...', 'info');
            try {
                const backups = await API.listS3Backups();
                if (backups.length === 0) {
                    Settings.showToast('No backups available', 'warning');
                    return;
                }

                // Show restore modal
                const modal = document.getElementById('restore-modal');
                const list = document.getElementById('restore-backup-list');

                list.innerHTML = backups.map(b => {
                    const sizeKB = Math.round(b.size / 1024);
                    const sizeMB = (b.size / 1024 / 1024).toFixed(2);
                    const sizeStr = b.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
                    const dateStr = b.last_modified ? new Date(b.last_modified).toLocaleString() : '-';
                    return `
                        <div class="backup-item" onclick="window.dashboard.selectBackup('${b.key}')">
                            <div class="backup-key mono">${b.key}</div>
                            <div class="backup-meta">
                                <span class="backup-size">${sizeStr}</span>
                                <span class="backup-date">${dateStr}</span>
                            </div>
                        </div>
                    `;
                }).join('');

                modal.classList.remove('hidden');
            } catch (e) {
                Settings.showToast('Failed to load backups: ' + e.message, 'error');
            }
        },
        selectBackup: (key) => {
            document.querySelectorAll('.backup-item').forEach(el => el.classList.remove('selected'));
            event.currentTarget.classList.add('selected');
            window.selectedBackupKey = key;
        },
        closeRestoreModal: () => {
            document.getElementById('restore-modal').classList.add('hidden');
            window.selectedBackupKey = null;
        },
        confirmRestore: async () => {
            const key = window.selectedBackupKey;
            if (!key) {
                Settings.showToast('Please select a backup to restore', 'warning');
                return;
            }

            if (!confirm(`Are you sure you want to restore from:\n${key}\n\nThis will replace the current database. The server will need to be restarted.`)) {
                return;
            }

            Settings.showToast('Restoring backup...', 'info');
            try {
                const result = await API.restoreS3Backup(key);
                if (result.ok) {
                    window.dashboard.closeRestoreModal();
                    Settings.showToast('Restore completed! Please restart the server.', 'success');
                } else {
                    Settings.showToast('Restore failed: ' + (result.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                Settings.showToast('Restore failed: ' + e.message, 'error');
            }
        }
    };

    // Expose global functions
    window.showSection = showSection;
    window.searchJobs = searchJobs;
    window.clearJobFilters = clearJobFilters;
    window.nextJobPage = nextJobPage;
    window.prevJobPage = prevJobPage;
    window.setChartRange = setChartRange;
    window.refreshData = fetchAllData;
    window.filterQueues = () => {}; // TODO: implement queue filtering
    window.toggleSelectAll = () => {
        const checkbox = document.getElementById('select-all-jobs');
        state.jobs.forEach(j => {
            if (checkbox.checked) {
                state.selectedJobs.add(j.id);
            } else {
                state.selectedJobs.delete(j.id);
            }
        });
        document.getElementById('selected-count').textContent = state.selectedJobs.size;
        document.getElementById('bulk-actions').classList.toggle('hidden', state.selectedJobs.size === 0);
        updateJobsUI();
    };
    window.clearSelection = () => {
        state.selectedJobs.clear();
        document.getElementById('select-all-jobs').checked = false;
        document.getElementById('bulk-actions').classList.add('hidden');
        updateJobsUI();
    };

    // Initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
