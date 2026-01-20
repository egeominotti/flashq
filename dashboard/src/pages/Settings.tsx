import { useState, useEffect } from 'react';
import {
  Card,
  Title,
  Text,
  TextInput,
  NumberInput,
  Button,
  Flex,
  Grid,
  Badge,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Switch,
  Divider,
} from '@tremor/react';
import {
  RefreshCw,
  Database,
  Cloud,
  Server,
  Shield,
  Download,
  Upload,
  AlertCircle,
  HardDrive,
  Link,
  Check,
  X,
  Trash2,
  Clock,
  Zap,
  Save,
  TestTube,
  Power,
  RotateCcw,
} from 'lucide-react';
import { useSettings } from '../hooks';
import {
  api,
  getConnectionConfig,
  setApiUrl,
  setAuthToken,
  testConnection,
  type S3SettingsPayload,
} from '../api/client';
import { formatRelativeTime, formatBytes } from '../utils';
import './Settings.css';

interface S3Backup {
  key: string;
  size: number;
  last_modified?: string;
}

export function Settings() {
  const { data: settings, refetch } = useSettings();

  // Connection state
  const [serverUrl, setServerUrl] = useState('');
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionError, setConnectionError] = useState<string>('');

  // S3 Configuration state
  const [s3Enabled, setS3Enabled] = useState(false);
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('auto');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3Interval, setS3Interval] = useState(300);
  const [s3KeepCount, setS3KeepCount] = useState(24);
  const [s3Compress, setS3Compress] = useState(true);
  const [s3Status, setS3Status] = useState<'idle' | 'testing' | 'saving' | 'success' | 'error'>('idle');
  const [s3Error, setS3Error] = useState('');

  // S3 Backups
  const [backups, setBackups] = useState<S3Backup[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  // Auth Settings
  const [authTokens, setAuthTokens] = useState('');
  const [authSaving, setAuthSaving] = useState(false);

  // Queue Defaults
  const [queueTimeout, setQueueTimeout] = useState<number>(30000);
  const [queueMaxAttempts, setQueueMaxAttempts] = useState<number>(3);
  const [queueBackoff, setQueueBackoff] = useState<number>(1000);
  const [queueTtl, setQueueTtl] = useState<number>(0);
  const [queueSaving, setQueueSaving] = useState(false);

  // Cleanup Settings
  const [maxCompletedJobs, setMaxCompletedJobs] = useState<number>(50000);
  const [maxJobResults, setMaxJobResults] = useState<number>(5000);
  const [cleanupInterval, setCleanupInterval] = useState<number>(60);
  const [metricsHistorySize, setMetricsHistorySize] = useState<number>(1000);
  const [cleanupSaving, setCleanupSaving] = useState(false);

  // SQLite Settings
  const [sqliteEnabled, setSqliteEnabled] = useState(false);
  const [sqlitePath, setSqlitePath] = useState('flashq.db');
  const [sqliteSynchronous, setSqliteSynchronous] = useState(true);
  const [sqliteCacheSize, setSqliteCacheSize] = useState(64);
  const [sqliteStatus, setSqliteStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [sqliteError, setSqliteError] = useState('');

  // Load initial connection config
  useEffect(() => {
    const config = getConnectionConfig();
    setServerUrl(config.url);
    setAuthTokenInput(config.token);
  }, []);

  // Load S3 and SQLite settings when settings are fetched
  useEffect(() => {
    if (settings) {
      // S3 settings
      setS3Enabled(settings.s3_backup?.enabled || false);
      setS3Endpoint(settings.s3_backup?.endpoint || '');
      setS3Bucket(settings.s3_backup?.bucket || '');
      setS3Region(settings.s3_backup?.region || 'auto');
      setS3Interval(settings.s3_backup?.interval_secs || 300);
      setS3KeepCount(settings.s3_backup?.keep_count || 24);
      setS3Compress(settings.s3_backup?.compress ?? true);

      // SQLite settings
      setSqliteEnabled(settings.sqlite?.enabled || false);
      setSqlitePath(settings.sqlite?.path || 'flashq.db');
      setSqliteSynchronous(settings.sqlite?.synchronous ?? true);
    }
  }, [settings]);

  // Connection handlers
  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    const result = await testConnection(serverUrl);
    if (result.success) {
      setConnectionStatus('success');
    } else {
      setConnectionStatus('error');
      setConnectionError(result.error || 'Connection failed');
    }
  };

  const handleSaveConnection = () => {
    setApiUrl(serverUrl);
    setAuthToken(authTokenInput);
    refetch();
    window.location.reload();
  };

  // S3 handlers
  const getS3Payload = (): S3SettingsPayload => ({
    enabled: s3Enabled,
    endpoint: s3Endpoint,
    bucket: s3Bucket,
    region: s3Region,
    access_key: s3AccessKey,
    secret_key: s3SecretKey,
    interval_secs: s3Interval,
    keep_count: s3KeepCount,
    compress: s3Compress,
  });

  const handleTestS3 = async () => {
    setS3Status('testing');
    setS3Error('');
    const result = await api.testS3Connection(getS3Payload());
    if (result.ok) {
      setS3Status('success');
    } else {
      setS3Status('error');
      setS3Error(result.error || 'Connection failed');
    }
  };

  const handleSaveS3 = async () => {
    setS3Status('saving');
    setS3Error('');
    const result = await api.saveS3Settings(getS3Payload());
    if (result.ok) {
      setS3Status('success');
      refetch();
    } else {
      setS3Status('error');
      setS3Error(result.error || 'Failed to save');
    }
  };

  const loadBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const response = await api.listS3Backups();
      if (Array.isArray(response)) {
        setBackups(response);
      } else {
        setBackups([]);
      }
    } catch (error) {
      console.error('Failed to load backups:', error);
    }
    setIsLoadingBackups(false);
  };

  const triggerBackup = async () => {
    setIsBackingUp(true);
    try {
      await api.triggerS3Backup();
      loadBackups();
    } catch (error) {
      console.error('Failed to trigger backup:', error);
    }
    setIsBackingUp(false);
  };

  const restoreBackup = async (key: string) => {
    if (!confirm(`Restore from "${key}"? This will replace all current data and restart the server.`)) {
      return;
    }
    setIsRestoring(true);
    try {
      await api.restoreS3Backup(key);
      refetch();
    } catch (error) {
      console.error('Failed to restore backup:', error);
    }
    setIsRestoring(false);
  };

  // Auth handlers
  const handleSaveAuth = async () => {
    setAuthSaving(true);
    await api.saveAuthSettings(authTokens);
    setAuthSaving(false);
    refetch();
  };

  // Queue defaults handlers
  const handleSaveQueueDefaults = async () => {
    setQueueSaving(true);
    await api.saveQueueDefaults({
      default_timeout: queueTimeout,
      default_max_attempts: queueMaxAttempts,
      default_backoff: queueBackoff,
      default_ttl: queueTtl || undefined,
    });
    setQueueSaving(false);
    refetch();
  };

  // Cleanup handlers
  const handleSaveCleanup = async () => {
    setCleanupSaving(true);
    await api.saveCleanupSettings({
      max_completed_jobs: maxCompletedJobs,
      max_job_results: maxJobResults,
      cleanup_interval_secs: cleanupInterval,
      metrics_history_size: metricsHistorySize,
    });
    setCleanupSaving(false);
    refetch();
  };

  const handleRunCleanup = async () => {
    await api.runCleanup();
  };

  // SQLite handlers
  const handleSaveSqlite = async () => {
    setSqliteStatus('saving');
    setSqliteError('');
    const result = await api.saveSqliteSettings({
      enabled: sqliteEnabled,
      path: sqlitePath,
      synchronous: sqliteSynchronous,
      cache_size_mb: sqliteCacheSize,
    });
    if (result.ok) {
      setSqliteStatus('success');
      refetch();
    } else {
      setSqliteStatus('error');
      setSqliteError(result.error || 'Failed to save');
    }
  };

  // Server management
  const handleClearQueues = async () => {
    if (!confirm('Clear all queues? This will remove all pending jobs.')) return;
    await api.clearAllQueues();
    refetch();
  };

  const handleClearDlq = async () => {
    if (!confirm('Clear all DLQ entries? This cannot be undone.')) return;
    await api.clearAllDlq();
    refetch();
  };

  const handleClearCompleted = async () => {
    await api.clearCompletedJobs();
    refetch();
  };

  const handleResetMetrics = async () => {
    if (!confirm('Reset all metrics? Historical data will be lost.')) return;
    await api.resetMetrics();
    refetch();
  };

  const handleRestartServer = async () => {
    if (!confirm('Restart the server? All connections will be temporarily disconnected.')) return;
    await api.restartServer();
  };

  const handleShutdownServer = async () => {
    if (!confirm('Shutdown the server? This will stop all processing.')) return;
    await api.shutdownServer();
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Settings</Title>
          <Text className="page-subtitle">
            Configure server, persistence, backup, and security settings
          </Text>
        </div>
        <Button icon={RefreshCw} variant="secondary" onClick={() => refetch()}>
          Refresh
        </Button>
      </header>

      {/* Connection Configuration */}
      <Card className="settings-card mb-6">
        <Flex alignItems="start" justifyContent="between" className="mb-6">
          <Flex alignItems="start">
            <div className="card-icon amber">
              <Link className="w-5 h-5" />
            </div>
            <div className="ml-4">
              <Title>Connection</Title>
              <Text>Configure the flashQ server URL and authentication</Text>
            </div>
          </Flex>
          <Badge color={connectionStatus === 'success' ? 'emerald' : connectionStatus === 'error' ? 'rose' : 'zinc'}>
            {connectionStatus === 'success' ? 'Connected' : connectionStatus === 'error' ? 'Failed' : 'Not Tested'}
          </Badge>
        </Flex>

        <Grid numItemsSm={1} numItemsLg={2} className="gap-4 mb-4">
          <div className="form-group">
            <label className="form-label">Server URL</label>
            <TextInput
              placeholder="http://localhost:6790"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Auth Token (optional)</label>
            <TextInput
              placeholder="Enter authentication token..."
              type="password"
              value={authTokenInput}
              onChange={(e) => setAuthTokenInput(e.target.value)}
            />
          </div>
        </Grid>

        {connectionStatus === 'error' && connectionError && (
          <div className="info-box warning mb-4">
            <X className="w-4 h-4" />
            <Text>{connectionError}</Text>
          </div>
        )}

        {connectionStatus === 'success' && (
          <div className="info-box success mb-4">
            <Check className="w-4 h-4" />
            <Text>Connection successful!</Text>
          </div>
        )}

        <Flex className="gap-3">
          <Button variant="secondary" onClick={handleTestConnection} loading={connectionStatus === 'testing'}>
            <TestTube className="w-4 h-4 mr-2" /> Test Connection
          </Button>
          <Button onClick={handleSaveConnection}>
            <Save className="w-4 h-4 mr-2" /> Save & Reconnect
          </Button>
        </Flex>
      </Card>

      <Grid numItemsSm={1} numItemsLg={2} className="gap-6 mb-6">
        {/* Server Info */}
        <Card className="settings-card">
          <Flex alignItems="start" className="mb-6">
            <div className="card-icon cyan">
              <Server className="w-5 h-5" />
            </div>
            <div className="ml-4">
              <Title>Server Information</Title>
              <Text>Current server status and configuration</Text>
            </div>
          </Flex>

          <div className="settings-grid">
            <div className="setting-item">
              <span className="setting-label">Version</span>
              <Badge color="cyan">{settings?.version || '0.2.0'}</Badge>
            </div>
            <div className="setting-item">
              <span className="setting-label">TCP Port</span>
              <span className="setting-value mono">{settings?.tcp_port || 6789}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">HTTP Port</span>
              <span className="setting-value mono">{settings?.http_port || 6790}</span>
            </div>
            <div className="setting-item">
              <span className="setting-label">Uptime</span>
              <span className="setting-value mono">
                {settings?.uptime_seconds ? formatRelativeTime(new Date(Date.now() - settings.uptime_seconds * 1000).toISOString()) : '-'}
              </span>
            </div>
          </div>

          <Divider className="my-4" />

          <Text className="text-sm text-zinc-400 mb-3">Server Management</Text>
          <Flex className="gap-2 flex-wrap">
            <Button size="xs" variant="secondary" onClick={handleRestartServer}>
              <RotateCcw className="w-3 h-3 mr-1" /> Restart
            </Button>
            <Button size="xs" variant="secondary" color="rose" onClick={handleShutdownServer}>
              <Power className="w-3 h-3 mr-1" /> Shutdown
            </Button>
          </Flex>
        </Card>

        {/* SQLite Persistence */}
        <Card className="settings-card">
          <Flex alignItems="start" justifyContent="between" className="mb-6">
            <Flex alignItems="start">
              <div className="card-icon emerald">
                <Database className="w-5 h-5" />
              </div>
              <div className="ml-4">
                <Title>Persistence (SQLite)</Title>
                <Text>Local database configuration</Text>
              </div>
            </Flex>
            <Switch
              checked={sqliteEnabled}
              onChange={setSqliteEnabled}
            />
          </Flex>

          {sqliteEnabled ? (
            <>
              <Grid numItemsSm={2} className="gap-4 mb-4">
                <div className="form-group">
                  <label className="form-label">Database Path</label>
                  <TextInput
                    placeholder="flashq.db"
                    value={sqlitePath}
                    onChange={(e) => setSqlitePath(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Cache Size (MB)</label>
                  <NumberInput
                    value={sqliteCacheSize}
                    onValueChange={setSqliteCacheSize}
                    min={16}
                    max={1024}
                    step={16}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Synchronous Mode</label>
                  <div className="mt-2">
                    <Switch checked={sqliteSynchronous} onChange={setSqliteSynchronous} />
                    <span className="ml-2 text-sm text-zinc-400">
                      {sqliteSynchronous ? 'NORMAL (safer)' : 'OFF (faster)'}
                    </span>
                  </div>
                </div>
              </Grid>

              {sqliteStatus === 'error' && sqliteError && (
                <div className="info-box warning mb-4">
                  <X className="w-4 h-4" />
                  <Text>{sqliteError}</Text>
                </div>
              )}

              {sqliteStatus === 'success' && (
                <div className="info-box success mb-4">
                  <Check className="w-4 h-4" />
                  <Text>SQLite configuration saved. Restart server to apply changes.</Text>
                </div>
              )}

              <Button onClick={handleSaveSqlite} loading={sqliteStatus === 'saving'}>
                <Save className="w-4 h-4 mr-2" /> Save Configuration
              </Button>

              {settings?.sqlite?.enabled && (
                <>
                  <Divider className="my-4" />
                  <Text className="text-sm text-zinc-400 mb-2">Current Active Settings</Text>
                  <div className="settings-grid">
                    <div className="setting-item">
                      <span className="setting-label">Status</span>
                      <Badge color="emerald">Active</Badge>
                    </div>
                    <div className="setting-item">
                      <span className="setting-label">Path</span>
                      <span className="setting-value mono text-sm">{settings.sqlite.path || 'flashq.db'}</span>
                    </div>
                    <div className="setting-item">
                      <span className="setting-label">WAL Mode</span>
                      <Badge color="emerald">Enabled</Badge>
                    </div>
                    <div className="setting-item">
                      <span className="setting-label">Synchronous</span>
                      <Badge color={settings.sqlite.synchronous ? 'emerald' : 'amber'}>
                        {settings.sqlite.synchronous ? 'NORMAL' : 'OFF'}
                      </Badge>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="info-box warning">
              <AlertCircle className="w-4 h-4" />
              <div>
                <Text className="font-medium">Persistence Disabled</Text>
                <Text className="text-sm mt-1">
                  Enable the toggle above to configure SQLite persistence.
                  Without persistence, data will be lost on restart.
                </Text>
              </div>
            </div>
          )}
        </Card>
      </Grid>

      {/* S3 Backup Configuration */}
      <Card className="settings-card mb-6">
        <Flex alignItems="start" justifyContent="between" className="mb-6">
          <Flex alignItems="start">
            <div className="card-icon blue">
              <Cloud className="w-5 h-5" />
            </div>
            <div className="ml-4">
              <Title>S3 Backup</Title>
              <Text>Remote backup to S3-compatible storage (AWS S3, R2, MinIO, etc.)</Text>
            </div>
          </Flex>
          <Switch
            checked={s3Enabled}
            onChange={setS3Enabled}
          />
        </Flex>

        {s3Enabled && (
          <>
            <Grid numItemsSm={1} numItemsMd={2} numItemsLg={3} className="gap-4 mb-4">
              <div className="form-group">
                <label className="form-label">Endpoint URL *</label>
                <TextInput
                  placeholder="https://s3.amazonaws.com"
                  value={s3Endpoint}
                  onChange={(e) => setS3Endpoint(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Bucket Name *</label>
                <TextInput
                  placeholder="my-flashq-backups"
                  value={s3Bucket}
                  onChange={(e) => setS3Bucket(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Region</label>
                <TextInput
                  placeholder="auto"
                  value={s3Region}
                  onChange={(e) => setS3Region(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Access Key *</label>
                <TextInput
                  placeholder="AKIAIOSFODNN7EXAMPLE"
                  value={s3AccessKey}
                  onChange={(e) => setS3AccessKey(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Secret Key *</label>
                <TextInput
                  type="password"
                  placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                  value={s3SecretKey}
                  onChange={(e) => setS3SecretKey(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Backup Interval (seconds)</label>
                <NumberInput
                  value={s3Interval}
                  onValueChange={setS3Interval}
                  min={60}
                  step={60}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Keep Backups Count</label>
                <NumberInput
                  value={s3KeepCount}
                  onValueChange={setS3KeepCount}
                  min={1}
                  max={100}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Compression</label>
                <div className="mt-2">
                  <Switch checked={s3Compress} onChange={setS3Compress} />
                  <span className="ml-2 text-sm text-zinc-400">
                    {s3Compress ? 'Enabled (gzip)' : 'Disabled'}
                  </span>
                </div>
              </div>
            </Grid>

            {s3Status === 'error' && s3Error && (
              <div className="info-box warning mb-4">
                <X className="w-4 h-4" />
                <Text>{s3Error}</Text>
              </div>
            )}

            {s3Status === 'success' && (
              <div className="info-box success mb-4">
                <Check className="w-4 h-4" />
                <Text>S3 configuration saved successfully!</Text>
              </div>
            )}

            <Flex className="gap-3 mb-6">
              <Button
                variant="secondary"
                onClick={handleTestS3}
                loading={s3Status === 'testing'}
                disabled={!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey}
              >
                <TestTube className="w-4 h-4 mr-2" /> Test Connection
              </Button>
              <Button
                onClick={handleSaveS3}
                loading={s3Status === 'saving'}
                disabled={!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey}
              >
                <Save className="w-4 h-4 mr-2" /> Save Configuration
              </Button>
            </Flex>

            <Divider className="my-4" />

            <Flex alignItems="center" justifyContent="between" className="mb-4">
              <Text className="font-medium">Available Backups</Text>
              <Flex className="gap-2">
                <Button
                  size="xs"
                  icon={Upload}
                  onClick={triggerBackup}
                  loading={isBackingUp}
                >
                  Backup Now
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  icon={RefreshCw}
                  onClick={loadBackups}
                  loading={isLoadingBackups}
                >
                  Refresh
                </Button>
              </Flex>
            </Flex>

            {backups.length > 0 ? (
              <div className="backups-table">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Backup File</TableHeaderCell>
                      <TableHeaderCell className="text-right">Size</TableHeaderCell>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell className="text-right">Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {backups.map((backup) => (
                      <TableRow key={backup.key}>
                        <TableCell>
                          <span className="font-mono text-white">{backup.key.split('/').pop()}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-mono text-zinc-400">{formatBytes(backup.size)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-zinc-400">
                            {backup.last_modified ? formatRelativeTime(backup.last_modified) : '-'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="xs"
                            variant="secondary"
                            icon={Download}
                            onClick={() => restoreBackup(backup.key)}
                            loading={isRestoring}
                          >
                            Restore
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-6 text-zinc-500">
                <HardDrive className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <Text>No backups found. Click "Refresh" to load backups.</Text>
              </div>
            )}
          </>
        )}

        {!s3Enabled && (
          <div className="info-box">
            <Cloud className="w-4 h-4" />
            <div>
              <Text className="font-medium">S3 Backup Disabled</Text>
              <Text className="text-sm mt-1">
                Enable the toggle above and configure your S3-compatible storage credentials
                to enable automatic remote backups.
              </Text>
            </div>
          </div>
        )}
      </Card>

      {/* Security Section */}
      <Card className="settings-card mb-6">
        <Flex alignItems="start" className="mb-6">
          <div className="card-icon violet">
            <Shield className="w-5 h-5" />
          </div>
          <div className="ml-4">
            <Title>Security & Authentication</Title>
            <Text>Configure access control and security settings</Text>
          </div>
        </Flex>

        <div className="form-group mb-4">
          <label className="form-label">Auth Tokens (comma-separated)</label>
          <TextInput
            placeholder="token1, token2, token3"
            value={authTokens}
            onChange={(e) => setAuthTokens(e.target.value)}
          />
          <Text className="text-xs text-zinc-500 mt-1">
            Leave empty to disable authentication. Multiple tokens can be separated by commas.
          </Text>
        </div>

        <Button onClick={handleSaveAuth} loading={authSaving}>
          <Save className="w-4 h-4 mr-2" /> Save Auth Settings
        </Button>

        <Divider className="my-4" />

        <div className="settings-grid">
          <div className="setting-item">
            <span className="setting-label">Token Authentication</span>
            <Badge color={settings?.auth_enabled ? 'emerald' : 'zinc'}>
              {settings?.auth_enabled ? `Enabled (${settings.auth_token_count} tokens)` : 'Disabled'}
            </Badge>
          </div>
          <div className="setting-item">
            <span className="setting-label">Webhook Signatures</span>
            <Badge color="emerald">HMAC-SHA256</Badge>
          </div>
          <div className="setting-item">
            <span className="setting-label">Max Payload Size</span>
            <span className="setting-value mono">10 MB</span>
          </div>
          <div className="setting-item">
            <span className="setting-label">Rate Limiting</span>
            <Badge color="emerald">Per-Queue</Badge>
          </div>
        </div>
      </Card>

      <Grid numItemsSm={1} numItemsLg={2} className="gap-6 mb-6">
        {/* Queue Defaults */}
        <Card className="settings-card">
          <Flex alignItems="start" className="mb-6">
            <div className="card-icon cyan">
              <Zap className="w-5 h-5" />
            </div>
            <div className="ml-4">
              <Title>Queue Defaults</Title>
              <Text>Default settings for new jobs</Text>
            </div>
          </Flex>

          <Grid numItemsSm={2} className="gap-4 mb-4">
            <div className="form-group">
              <label className="form-label">Timeout (ms)</label>
              <NumberInput
                value={queueTimeout}
                onValueChange={setQueueTimeout}
                min={1000}
                step={1000}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Max Attempts</label>
              <NumberInput
                value={queueMaxAttempts}
                onValueChange={setQueueMaxAttempts}
                min={1}
                max={100}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Backoff (ms)</label>
              <NumberInput
                value={queueBackoff}
                onValueChange={setQueueBackoff}
                min={100}
                step={100}
              />
            </div>
            <div className="form-group">
              <label className="form-label">TTL (ms, 0=none)</label>
              <NumberInput
                value={queueTtl}
                onValueChange={setQueueTtl}
                min={0}
                step={1000}
              />
            </div>
          </Grid>

          <Button onClick={handleSaveQueueDefaults} loading={queueSaving}>
            <Save className="w-4 h-4 mr-2" /> Save Defaults
          </Button>
        </Card>

        {/* Cleanup Settings */}
        <Card className="settings-card">
          <Flex alignItems="start" className="mb-6">
            <div className="card-icon amber">
              <Clock className="w-5 h-5" />
            </div>
            <div className="ml-4">
              <Title>Cleanup & Retention</Title>
              <Text>Automatic cleanup configuration</Text>
            </div>
          </Flex>

          <Grid numItemsSm={2} className="gap-4 mb-4">
            <div className="form-group">
              <label className="form-label">Max Completed Jobs</label>
              <NumberInput
                value={maxCompletedJobs}
                onValueChange={setMaxCompletedJobs}
                min={1000}
                step={1000}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Max Job Results</label>
              <NumberInput
                value={maxJobResults}
                onValueChange={setMaxJobResults}
                min={100}
                step={100}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Cleanup Interval (sec)</label>
              <NumberInput
                value={cleanupInterval}
                onValueChange={setCleanupInterval}
                min={10}
                step={10}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Metrics History Size</label>
              <NumberInput
                value={metricsHistorySize}
                onValueChange={setMetricsHistorySize}
                min={100}
                step={100}
              />
            </div>
          </Grid>

          <Flex className="gap-2">
            <Button onClick={handleSaveCleanup} loading={cleanupSaving}>
              <Save className="w-4 h-4 mr-2" /> Save Settings
            </Button>
            <Button variant="secondary" onClick={handleRunCleanup}>
              <Trash2 className="w-4 h-4 mr-2" /> Run Cleanup Now
            </Button>
          </Flex>
        </Card>
      </Grid>

      {/* Danger Zone */}
      <Card className="settings-card border-rose-500/30">
        <Flex alignItems="start" className="mb-6">
          <div className="card-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="ml-4">
            <Title>Danger Zone</Title>
            <Text>Irreversible operations - use with caution</Text>
          </div>
        </Flex>

        <Flex className="gap-3 flex-wrap">
          <Button variant="secondary" color="rose" onClick={handleClearQueues}>
            <Trash2 className="w-4 h-4 mr-2" /> Clear All Queues
          </Button>
          <Button variant="secondary" color="rose" onClick={handleClearDlq}>
            <Trash2 className="w-4 h-4 mr-2" /> Clear All DLQ
          </Button>
          <Button variant="secondary" color="rose" onClick={handleClearCompleted}>
            <Trash2 className="w-4 h-4 mr-2" /> Clear Completed Jobs
          </Button>
          <Button variant="secondary" color="rose" onClick={handleResetMetrics}>
            <RotateCcw className="w-4 h-4 mr-2" /> Reset Metrics
          </Button>
        </Flex>
      </Card>
    </div>
  );
}
