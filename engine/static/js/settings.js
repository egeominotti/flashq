// ============================================================================
// FlashQ Dashboard - Settings
// ============================================================================

window.DashboardSettings = (function() {
    let serverStartTime = Date.now();

    return {
        updateUI(settings) {
            // Update uptime
            if (settings.uptime_seconds) {
                const hours = Math.floor(settings.uptime_seconds / 3600);
                const mins = Math.floor((settings.uptime_seconds % 3600) / 60);
                document.getElementById('settings-uptime').textContent = `${hours}h ${mins}m`;
            }

            // SQLite status and settings
            const sqliteStatus = document.getElementById('sqlite-status');
            const sqliteStatusText = document.getElementById('sqlite-status-text');

            if (settings.sqlite && settings.sqlite.enabled) {
                if (sqliteStatus) sqliteStatus.classList.add('enabled');
                if (sqliteStatusText) sqliteStatusText.textContent = 'Enabled';

                // Populate editable fields
                const sqlitePath = document.getElementById('sqlite-path');
                const sqliteSynchronous = document.getElementById('sqlite-synchronous');
                const sqliteSnapshotInterval = document.getElementById('sqlite-snapshot-interval');
                const sqliteMinChanges = document.getElementById('sqlite-min-changes');

                if (sqlitePath && settings.sqlite.path) sqlitePath.value = settings.sqlite.path;
                if (sqliteSynchronous) sqliteSynchronous.value = settings.sqlite.synchronous ? '1' : '0';
                if (sqliteSnapshotInterval && settings.sqlite.snapshot_interval) {
                    sqliteSnapshotInterval.value = settings.sqlite.snapshot_interval;
                }
                if (sqliteMinChanges && settings.sqlite.snapshot_min_changes) {
                    sqliteMinChanges.value = settings.sqlite.snapshot_min_changes;
                }
            } else {
                if (sqliteStatus) sqliteStatus.classList.remove('enabled');
                if (sqliteStatusText) sqliteStatusText.textContent = 'In-Memory Mode';
            }

            // S3 Backup status and settings
            const s3Status = document.getElementById('s3-status');
            const s3StatusText = document.getElementById('s3-status-text');

            if (settings.s3_backup && settings.s3_backup.enabled) {
                if (s3Status) s3Status.classList.add('enabled');
                if (s3StatusText) s3StatusText.textContent = 'Enabled';

                // Populate editable fields
                const s3Enabled = document.getElementById('s3-enabled');
                const s3Endpoint = document.getElementById('s3-endpoint');
                const s3Bucket = document.getElementById('s3-bucket');
                const s3Region = document.getElementById('s3-region');
                const s3Interval = document.getElementById('s3-interval');
                const s3KeepCount = document.getElementById('s3-keep-count');
                const s3Compress = document.getElementById('s3-compress');

                if (s3Enabled) s3Enabled.checked = true;
                if (s3Endpoint && settings.s3_backup.endpoint) s3Endpoint.value = settings.s3_backup.endpoint;
                if (s3Bucket && settings.s3_backup.bucket) s3Bucket.value = settings.s3_backup.bucket;
                if (s3Region) s3Region.value = settings.s3_backup.region || 'auto';
                if (s3Interval) s3Interval.value = settings.s3_backup.interval_secs || 300;
                if (s3KeepCount) s3KeepCount.value = settings.s3_backup.keep_count || 24;
                if (s3Compress) s3Compress.checked = settings.s3_backup.compress !== false;
            } else {
                if (s3Status) s3Status.classList.remove('enabled');
                if (s3StatusText) s3StatusText.textContent = 'Disabled';

                const s3Enabled = document.getElementById('s3-enabled');
                if (s3Enabled) s3Enabled.checked = false;
            }

            // Auth status
            const authStatus = document.getElementById('auth-status');
            const authStatusText = document.getElementById('auth-status-text');

            if (settings.auth_enabled) {
                if (authStatus) authStatus.classList.add('enabled');
                if (authStatusText) authStatusText.textContent = `${settings.auth_token_count || 0} tokens`;
            } else {
                if (authStatus) authStatus.classList.remove('enabled');
                if (authStatusText) authStatusText.textContent = 'Disabled';
            }

            // Server info
            if (settings.tcp_port) {
                document.getElementById('settings-tcp-port').textContent = settings.tcp_port;
            }
            if (settings.http_port) {
                document.getElementById('settings-http-port').textContent = settings.http_port;
            }
            if (settings.version) {
                document.getElementById('settings-version').textContent = settings.version;
            }
        },

        async saveAuthSettings() {
            const tokens = document.getElementById('settings-auth-tokens').value.trim();
            const tokenArray = tokens ? tokens.split(',').map(t => t.trim()).filter(t => t) : [];

            try {
                const data = await DashboardAPI.saveAuthSettings(tokenArray.join(','));
                if (data.ok) {
                    this.showToast('Auth settings saved successfully', 'success');
                } else {
                    this.showToast('Failed to save: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Failed to save settings', 'error');
            }
        },

        toggleTokenVisibility() {
            const input = document.getElementById('settings-auth-tokens');
            const icon = document.getElementById('token-eye-icon');

            if (input.type === 'password') {
                input.type = 'text';
            } else {
                input.type = 'password';
            }
        },

        generateToken() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let token = '';
            for (let i = 0; i < 32; i++) {
                token += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            document.getElementById('generated-token').value = token;
        },

        copyToken() {
            const token = document.getElementById('generated-token').value;
            if (token) {
                navigator.clipboard.writeText(token);
                this.showToast('Token copied to clipboard', 'success');
            }
        },

        async saveQueueDefaults() {
            const settings = {
                default_timeout: parseInt(document.getElementById('settings-default-timeout').value) || 30000,
                default_max_attempts: parseInt(document.getElementById('settings-default-attempts').value) || 3,
                default_backoff: parseInt(document.getElementById('settings-default-backoff').value) || 1000,
                default_ttl: parseInt(document.getElementById('settings-default-ttl').value) || 0
            };

            try {
                const data = await DashboardAPI.saveQueueDefaults(settings);
                if (data.ok) {
                    this.showToast('Queue defaults saved successfully', 'success');
                } else {
                    this.showToast('Failed to save: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Failed to save settings', 'error');
            }
        },

        async saveCleanupSettings() {
            const settings = {
                max_completed_jobs: parseInt(document.getElementById('settings-max-completed').value) || 50000,
                max_job_results: parseInt(document.getElementById('settings-max-results').value) || 5000,
                cleanup_interval_secs: parseInt(document.getElementById('settings-cleanup-interval').value) || 60,
                metrics_history_size: parseInt(document.getElementById('settings-metrics-history').value) || 1000
            };

            try {
                const data = await DashboardAPI.saveCleanupSettings(settings);
                if (data.ok) {
                    this.showToast('Cleanup settings saved successfully', 'success');
                } else {
                    this.showToast('Failed to save: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Failed to save settings', 'error');
            }
        },

        async runCleanupNow() {
            try {
                const data = await DashboardAPI.runCleanup();
                if (data.ok) {
                    this.showToast('Cleanup completed successfully', 'success');
                } else {
                    this.showToast('Cleanup failed: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Cleanup failed', 'error');
            }
        },

        async clearAllQueues(refreshCallback) {
            if (!confirm('Are you sure you want to clear ALL queues? This will delete all pending jobs.')) return;

            try {
                const data = await DashboardAPI.clearAllQueues();
                if (data.ok) {
                    this.showToast('All queues cleared successfully', 'success');
                    if (refreshCallback) refreshCallback();
                } else {
                    this.showToast('Failed: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Failed to clear queues', 'error');
            }
        },

        async clearAllDlq(refreshCallback) {
            if (!confirm('Are you sure you want to clear ALL dead letter queues?')) return;

            try {
                const data = await DashboardAPI.clearAllDlq();
                if (data.ok) {
                    this.showToast('All DLQ cleared successfully', 'success');
                    if (refreshCallback) refreshCallback();
                } else {
                    this.showToast('Failed: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Failed to clear DLQ', 'error');
            }
        },

        async clearCompletedJobs(refreshCallback) {
            if (!confirm('Are you sure you want to clear all completed jobs?')) return;

            try {
                const data = await DashboardAPI.clearCompletedJobs();
                if (data.ok) {
                    this.showToast('Completed jobs cleared successfully', 'success');
                    if (refreshCallback) refreshCallback();
                } else {
                    this.showToast('Failed: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Failed to clear completed jobs', 'error');
            }
        },

        async resetMetrics(refreshCallback) {
            if (!confirm('Are you sure you want to reset all metrics? This cannot be undone.')) return;

            try {
                const data = await DashboardAPI.resetMetrics();
                if (data.ok) {
                    this.showToast('Metrics reset successfully', 'success');
                    if (refreshCallback) refreshCallback();
                } else {
                    this.showToast('Failed: ' + (data.error || 'Unknown error'), 'error');
                }
            } catch (e) {
                this.showToast('Failed to reset metrics', 'error');
            }
        },

        async shutdownServer() {
            if (!confirm('Are you sure you want to shutdown the server? You will need to restart it manually.')) return;

            try {
                await DashboardAPI.shutdownServer();
                this.showToast('Server is shutting down...', 'warning');
            } catch (e) {
                // Connection will likely fail as server is shutting down
                this.showToast('Server shutdown initiated', 'warning');
            }
        },

        async restartServer() {
            if (!confirm('Are you sure you want to restart the server? The dashboard will reconnect automatically.')) return;

            try {
                await DashboardAPI.restartServer();
                this.showToast('Server is restarting...', 'warning');
                // Attempt to reload after delay
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            } catch (e) {
                // Connection will likely fail as server is restarting
                this.showToast('Server restart initiated. Reloading in 3 seconds...', 'warning');
                setTimeout(() => {
                    window.location.reload();
                }, 3000);
            }
        },

        // Toast notification helper
        showToast(message, type = 'info') {
            // Create toast container if it doesn't exist
            let container = document.getElementById('toast-container');
            if (!container) {
                container = document.createElement('div');
                container.id = 'toast-container';
                container.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    z-index: 9999;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                `;
                document.body.appendChild(container);
            }

            const toast = document.createElement('div');
            toast.className = `toast toast-${type}`;
            toast.style.cssText = `
                background: var(--bg-secondary, #1a1a1a);
                border: 1px solid ${type === 'success' ? 'var(--green, #10b981)' : type === 'error' ? 'var(--red, #ef4444)' : type === 'warning' ? 'var(--amber, #f59e0b)' : 'var(--cyan, #00d4ff)'};
                color: ${type === 'success' ? 'var(--green, #10b981)' : type === 'error' ? 'var(--red, #ef4444)' : type === 'warning' ? 'var(--amber, #f59e0b)' : 'var(--text-primary, #fff)'};
                padding: 12px 16px;
                border-radius: 6px;
                font-size: 14px;
                font-family: var(--font-mono, monospace);
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                animation: slideIn 0.3s ease;
            `;
            toast.textContent = message;

            // Add animation keyframes if not exists
            if (!document.getElementById('toast-styles')) {
                const style = document.createElement('style');
                style.id = 'toast-styles';
                style.textContent = `
                    @keyframes slideIn {
                        from { transform: translateX(100%); opacity: 0; }
                        to { transform: translateX(0); opacity: 1; }
                    }
                    @keyframes slideOut {
                        from { transform: translateX(0); opacity: 1; }
                        to { transform: translateX(100%); opacity: 0; }
                    }
                `;
                document.head.appendChild(style);
            }

            container.appendChild(toast);

            // Remove after 3 seconds
            setTimeout(() => {
                toast.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    };
})();
