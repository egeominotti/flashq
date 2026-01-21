import { useState, useEffect, useRef } from 'react';
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
  TabGroup,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
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
import { useSettings, useToast } from '../hooks';
import {
  api,
  getConnectionConfig,
  setApiUrl,
  setAuthToken,
  testConnection,
  type S3SettingsPayload,
} from '../api/client';
import { formatRelativeTime, formatBytes } from '../utils';
import { ConfirmModal } from '../components/common/ConfirmModal';
import './Settings.css';

interface S3Backup {
  key: string;
  size: number;
  last_modified?: string;
}

export function Settings() {
  const { data: settings, refetch } = useSettings();
  const { showToast } = useToast();

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    variant: 'danger' | 'warning' | 'info';
    confirmText: string;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: async () => {},
    variant: 'danger',
    confirmText: 'Confirm',
  });
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);

  // Connection state
  const [serverUrl, setServerUrl] = useState('');
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'testing' | 'success' | 'error'
  >('idle');
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
  const [s3Status, setS3Status] = useState<'idle' | 'testing' | 'saving' | 'success' | 'error'>(
    'idle'
  );
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

  // SQLite Stats
  const [sqliteStats, setSqliteStats] = useState<{
    enabled: boolean;
    path?: string;
    file_size_bytes: number;
    file_size_mb: number;
    total_jobs: number;
    queued_jobs: number;
    processing_jobs: number;
    completed_jobs: number;
    failed_jobs: number;
    delayed_jobs: number;
    async_writer_enabled: boolean;
    async_writer_queue_len: number;
    async_writer_ops_queued: number;
    async_writer_ops_written: number;
    async_writer_batches_written: number;
    async_writer_batch_interval_ms: number;
    async_writer_max_batch_size: number;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Async Writer Config
  const [asyncBatchInterval, setAsyncBatchInterval] = useState(50);
  const [asyncMaxBatchSize, setAsyncMaxBatchSize] = useState(1000);
  const [asyncWriterSaving, setAsyncWriterSaving] = useState(false);
  const [asyncWriterStatus, setAsyncWriterStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Load initial connection config
  useEffect(() => {
    const config = getConnectionConfig();
    setServerUrl(config.url);
    setAuthTokenInput(config.token);
  }, []);

  // Load S3 and SQLite settings from server
  useEffect(() => {
    if (settings) {
      // SQLite settings
      setSqliteEnabled(settings.sqlite?.enabled || false);
      setSqlitePath(settings.sqlite?.path || 'flashq.db');
      setSqliteSynchronous(settings.sqlite?.synchronous ?? true);

      // S3 settings
      setS3Enabled(settings.s3_backup?.enabled || false);
      setS3Endpoint(settings.s3_backup?.endpoint || '');
      setS3Bucket(settings.s3_backup?.bucket || '');
      setS3Region(settings.s3_backup?.region || 'auto');
      setS3Interval(settings.s3_backup?.interval_secs || 300);
      setS3KeepCount(settings.s3_backup?.keep_count || 24);
      setS3Compress(settings.s3_backup?.compress ?? true);
    }
  }, [settings]);

  // Fetch SQLite stats when enabled
  useEffect(() => {
    if (settings?.sqlite?.enabled) {
      api.getSqliteStats().then((stats) => {
        if (stats) {
          setSqliteStats(stats);
          // Initialize async writer config from current values
          if (stats.async_writer_enabled) {
            setAsyncBatchInterval(stats.async_writer_batch_interval_ms);
            setAsyncMaxBatchSize(stats.async_writer_max_batch_size);
          }
        }
      });
    }
  }, [settings?.sqlite?.enabled]);

  // Confirm modal handler
  const handleConfirm = async () => {
    setIsConfirmLoading(true);
    try {
      await confirmModal.onConfirm();
    } finally {
      setIsConfirmLoading(false);
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
    }
  };

  // Export SQLite database
  const handleExportSqlite = async () => {
    setIsExporting(true);
    try {
      // Open download in new tab
      const apiUrl = api.getApiUrl();
      window.open(`${apiUrl}/sqlite/download`, '_blank');
    } finally {
      setIsExporting(false);
    }
  };

  // Restore SQLite database from file
  const [isSqliteRestoring, setIsSqliteRestoring] = useState(false);
  const [sqliteRestoreError, setSqliteRestoreError] = useState('');
  const [sqliteRestoreSuccess, setSqliteRestoreSuccess] = useState(false);
  const sqliteFileInputRef = useRef<HTMLInputElement>(null);

  const handleRestoreSqlite = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSqliteRestoring(true);
    setSqliteRestoreError('');
    setSqliteRestoreSuccess(false);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const apiUrl = api.getApiUrl();
      const authToken = api.getAuthToken();
      const headers: HeadersInit = {};
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(`${apiUrl}/sqlite/restore`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const result = await response.json();
      if (result.ok) {
        setSqliteRestoreSuccess(true);
        showToast('Database restored successfully', 'success');
      } else {
        setSqliteRestoreError(result.error || 'Restore failed');
        showToast('Restore failed', 'error');
      }
    } catch (err) {
      setSqliteRestoreError(String(err));
      showToast('Restore failed', 'error');
    } finally {
      setIsSqliteRestoring(false);
      // Reset file input using ref for cross-browser compatibility
      if (sqliteFileInputRef.current) {
        sqliteFileInputRef.current.value = '';
      }
    }
  };

  // Connection handlers
  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setConnectionError('');
    const result = await testConnection(serverUrl);
    if (result.success) {
      setConnectionStatus('success');
      showToast('Connection successful', 'success');
    } else {
      setConnectionStatus('error');
      setConnectionError(result.error || 'Connection failed');
      showToast('Connection failed', 'error');
    }
  };

  const handleSaveConnection = () => {
    setApiUrl(serverUrl);
    setAuthToken(authTokenInput);
    showToast('Connection settings saved', 'success');
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
      showToast('S3 connection successful', 'success');
    } else {
      setS3Status('error');
      setS3Error(result.error || 'Connection failed');
      showToast('S3 connection failed', 'error');
    }
  };

  const handleSaveS3 = async () => {
    setS3Status('saving');
    setS3Error('');
    const payload = getS3Payload();
    const result = await api.saveS3Settings(payload);
    if (result.ok) {
      setS3Status('success');
      showToast('S3 settings saved', 'success');
      // Wait a bit then refetch to ensure server processed the request
      setTimeout(async () => {
        await refetch();
      }, 500);
    } else {
      setS3Status('error');
      setS3Error(result.error || 'Failed to save');
      showToast('Failed to save S3 settings', 'error');
    }
  };

  const loadBackups = async () => {
    setIsLoadingBackups(true);
    try {
      const response = await api.listS3Backups();
      setBackups(Array.isArray(response) ? response : []);
    } catch (error) {
      console.error('Failed to load backups:', error);
      showToast('Failed to load backups', 'error');
    }
    setIsLoadingBackups(false);
  };

  const triggerBackup = async () => {
    setIsBackingUp(true);
    try {
      await api.triggerS3Backup();
      showToast('Backup started', 'success');
      loadBackups();
    } catch (error) {
      console.error('Failed to trigger backup:', error);
      showToast('Failed to trigger backup', 'error');
    }
    setIsBackingUp(false);
  };

  const handleRestoreBackup = (key: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Restore from Backup',
      message: `Are you sure you want to restore from "${key.split('/').pop()}"? This will replace all current data and cannot be undone.`,
      variant: 'danger',
      confirmText: 'Restore Backup',
      onConfirm: async () => {
        setIsRestoring(true);
        try {
          await api.restoreS3Backup(key);
          showToast('Backup restored successfully', 'success');
          refetch();
        } catch (error) {
          console.error('Failed to restore backup:', error);
          showToast('Failed to restore backup', 'error');
        }
        setIsRestoring(false);
      },
    });
  };

  // Auth handlers
  const handleSaveAuth = async () => {
    setAuthSaving(true);
    await api.saveAuthSettings(authTokens);
    setAuthSaving(false);
    showToast('Auth settings saved', 'success');
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
    showToast('Queue defaults saved', 'success');
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
    showToast('Cleanup settings saved', 'success');
    refetch();
  };

  const handleRunCleanup = async () => {
    await api.runCleanup();
    showToast('Cleanup executed', 'success');
  };

  // Async Writer handlers
  const handleSaveAsyncWriter = async () => {
    setAsyncWriterSaving(true);
    setAsyncWriterStatus('idle');
    const result = await api.updateAsyncWriterConfig({
      batch_interval_ms: asyncBatchInterval,
      max_batch_size: asyncMaxBatchSize,
    });
    setAsyncWriterSaving(false);
    if (result.ok) {
      setAsyncWriterStatus('success');
      showToast('Async writer config updated', 'success');
      // Refresh stats
      const stats = await api.getSqliteStats();
      if (stats) setSqliteStats(stats);
    } else {
      setAsyncWriterStatus('error');
      showToast('Failed to update async writer config', 'error');
    }
  };

  // SQLite handlers
  const handleSaveSqlite = async () => {
    setSqliteStatus('saving');
    setSqliteError('');
    const payload = {
      enabled: sqliteEnabled,
      path: sqlitePath,
      synchronous: sqliteSynchronous,
      cache_size_mb: sqliteCacheSize,
    };
    const result = await api.saveSqliteSettings(payload);
    if (result.ok) {
      setSqliteStatus('success');
      showToast('SQLite settings saved. Restart server to apply.', 'success');
      setTimeout(async () => {
        await refetch();
      }, 500);
    } else {
      setSqliteStatus('error');
      setSqliteError(result.error || 'Failed to save');
      showToast('Failed to save SQLite settings', 'error');
    }
  };

  // Server management with confirmation modals
  const handleClearQueues = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Clear All Queues',
      message:
        'This will permanently remove ALL pending jobs from all queues. This action cannot be undone. Are you sure?',
      variant: 'danger',
      confirmText: 'Clear All Queues',
      onConfirm: async () => {
        await api.clearAllQueues();
        showToast('All queues cleared', 'success');
        refetch();
      },
    });
  };

  const handleClearDlq = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Clear Dead Letter Queue',
      message:
        'This will permanently remove ALL failed jobs from the DLQ. This action cannot be undone. Are you sure?',
      variant: 'danger',
      confirmText: 'Clear DLQ',
      onConfirm: async () => {
        await api.clearAllDlq();
        showToast('DLQ cleared', 'success');
        refetch();
      },
    });
  };

  const handleClearCompleted = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Clear Completed Jobs',
      message:
        'This will remove all completed job records. Historical data will be lost. Are you sure?',
      variant: 'warning',
      confirmText: 'Clear Completed',
      onConfirm: async () => {
        await api.clearCompletedJobs();
        showToast('Completed jobs cleared', 'success');
        refetch();
      },
    });
  };

  const handleResetMetrics = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Reset All Metrics',
      message:
        'This will reset all server metrics and historical data. Charts and analytics will be empty. Are you sure?',
      variant: 'danger',
      confirmText: 'Reset Metrics',
      onConfirm: async () => {
        await api.resetMetrics();
        showToast('Metrics reset', 'success');
        refetch();
      },
    });
  };

  const handleRestartServer = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Restart Server',
      message:
        'This will restart the flashQ server. All active connections will be dropped and in-progress jobs may be affected. Are you sure?',
      variant: 'warning',
      confirmText: 'Restart Server',
      onConfirm: async () => {
        await api.restartServer();
        showToast('Server restart initiated', 'info');
      },
    });
  };

  const handleShutdownServer = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Shutdown Server',
      message:
        'This will completely shutdown the flashQ server. You will need to manually restart it. All connections will be lost. Are you absolutely sure?',
      variant: 'danger',
      confirmText: 'Shutdown Server',
      onConfirm: async () => {
        await api.shutdownServer();
        showToast('Server shutdown initiated', 'info');
      },
    });
  };

  const handleResetServer = () => {
    setConfirmModal({
      isOpen: true,
      title: 'Factory Reset Server',
      message:
        'This will completely reset the server to factory defaults. ALL DATA including jobs, queues, metrics, and settings will be permanently deleted. This is IRREVERSIBLE. Are you absolutely sure?',
      variant: 'danger',
      confirmText: 'Factory Reset',
      onConfirm: async () => {
        await api.resetServer();
        showToast('Server reset initiated', 'info');
        refetch();
      },
    });
  };

  return (
    <div className="settings-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Settings</Title>
          <Text className="page-subtitle">Configure server, persistence, and backup settings</Text>
        </div>
        <Button icon={RefreshCw} variant="secondary" onClick={() => refetch()}>
          Refresh
        </Button>
      </header>

      <TabGroup>
        <TabList className="settings-tabs mb-6">
          <Tab icon={Server}>General</Tab>
          <Tab icon={Database}>Storage</Tab>
          <Tab icon={Cloud}>Backup</Tab>
          <Tab icon={Shield}>Security</Tab>
          <Tab icon={AlertCircle}>Advanced</Tab>
        </TabList>

        <TabPanels>
          {/* GENERAL TAB */}
          <TabPanel>
            <Grid numItemsSm={1} numItemsLg={2} className="gap-6">
              {/* Connection */}
              <Card className="settings-card">
                <Flex alignItems="center" className="mb-4">
                  <div className="card-icon amber">
                    <Link className="h-5 w-5" />
                  </div>
                  <div className="ml-3">
                    <Title className="text-base">Connection</Title>
                    <Text className="text-xs">Server URL and authentication</Text>
                  </div>
                  <Badge
                    className="ml-auto"
                    color={
                      connectionStatus === 'success'
                        ? 'emerald'
                        : connectionStatus === 'error'
                          ? 'rose'
                          : 'zinc'
                    }
                  >
                    {connectionStatus === 'success'
                      ? 'Connected'
                      : connectionStatus === 'error'
                        ? 'Failed'
                        : 'Not Tested'}
                  </Badge>
                </Flex>

                <div className="space-y-4">
                  <div className="form-group">
                    <label className="form-label">Server URL</label>
                    <TextInput
                      placeholder="http://localhost:6790"
                      value={serverUrl}
                      onChange={(e) => setServerUrl(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Auth Token</label>
                    <TextInput
                      placeholder="Optional"
                      type="password"
                      value={authTokenInput}
                      onChange={(e) => setAuthTokenInput(e.target.value)}
                    />
                  </div>

                  {connectionStatus === 'error' && connectionError && (
                    <div className="info-box warning">
                      <X className="h-4 w-4 flex-shrink-0" />
                      <Text className="text-sm">{connectionError}</Text>
                    </div>
                  )}

                  <Flex className="gap-2">
                    <Button
                      size="xs"
                      variant="secondary"
                      icon={TestTube}
                      onClick={handleTestConnection}
                      loading={connectionStatus === 'testing'}
                    >
                      Test
                    </Button>
                    <Button size="xs" icon={Save} onClick={handleSaveConnection}>
                      Save
                    </Button>
                  </Flex>
                </div>
              </Card>

              {/* Server Info */}
              <Card className="settings-card">
                <Flex alignItems="center" className="mb-4">
                  <div className="card-icon cyan">
                    <Server className="h-5 w-5" />
                  </div>
                  <div className="ml-3">
                    <Title className="text-base">Server Info</Title>
                    <Text className="text-xs">Status and configuration</Text>
                  </div>
                  <Badge className="ml-auto" color="emerald">
                    Online
                  </Badge>
                </Flex>

                <div className="settings-grid compact mb-4">
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
                    <span className="setting-label">Mode</span>
                    <Badge color={settings?.sqlite?.enabled ? 'emerald' : 'amber'}>
                      {settings?.sqlite?.enabled ? 'Persistent' : 'Memory'}
                    </Badge>
                  </div>
                </div>

                <Divider className="my-3" />
                <Text className="mb-3 text-xs text-zinc-500">Server Control</Text>
                <Flex className="gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={RotateCcw}
                    onClick={handleRestartServer}
                  >
                    Restart
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    color="rose"
                    icon={Power}
                    onClick={handleShutdownServer}
                  >
                    Shutdown
                  </Button>
                </Flex>
              </Card>

              {/* Queue Defaults */}
              <Card className="settings-card">
                <Flex alignItems="center" className="mb-4">
                  <div className="card-icon blue">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div className="ml-3">
                    <Title className="text-base">Queue Defaults</Title>
                    <Text className="text-xs">Default settings for new jobs</Text>
                  </div>
                </Flex>

                <Grid numItemsSm={2} className="mb-4 gap-3">
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
                    <label className="form-label">TTL (ms)</label>
                    <NumberInput value={queueTtl} onValueChange={setQueueTtl} min={0} step={1000} />
                  </div>
                </Grid>

                <Button
                  size="xs"
                  icon={Save}
                  onClick={handleSaveQueueDefaults}
                  loading={queueSaving}
                >
                  Save Defaults
                </Button>
              </Card>

              {/* Cleanup */}
              <Card className="settings-card">
                <Flex alignItems="center" className="mb-4">
                  <div className="card-icon violet">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div className="ml-3">
                    <Title className="text-base">Cleanup & Retention</Title>
                    <Text className="text-xs">Automatic cleanup settings</Text>
                  </div>
                </Flex>

                <Grid numItemsSm={2} className="mb-4 gap-3">
                  <div className="form-group">
                    <label className="form-label">Max Completed</label>
                    <NumberInput
                      value={maxCompletedJobs}
                      onValueChange={setMaxCompletedJobs}
                      min={1000}
                      step={1000}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Max Results</label>
                    <NumberInput
                      value={maxJobResults}
                      onValueChange={setMaxJobResults}
                      min={100}
                      step={100}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Interval (sec)</label>
                    <NumberInput
                      value={cleanupInterval}
                      onValueChange={setCleanupInterval}
                      min={10}
                      step={10}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">History Size</label>
                    <NumberInput
                      value={metricsHistorySize}
                      onValueChange={setMetricsHistorySize}
                      min={100}
                      step={100}
                    />
                  </div>
                </Grid>

                <Flex className="gap-2">
                  <Button size="xs" icon={Save} onClick={handleSaveCleanup} loading={cleanupSaving}>
                    Save
                  </Button>
                  <Button size="xs" variant="secondary" icon={Trash2} onClick={handleRunCleanup}>
                    Run Now
                  </Button>
                </Flex>
              </Card>
            </Grid>
          </TabPanel>

          {/* STORAGE TAB */}
          <TabPanel>
            <Card className="settings-card">
              <Flex alignItems="center" justifyContent="between" className="mb-6">
                <Flex alignItems="center">
                  <div className="card-icon emerald">
                    <Database className="h-5 w-5" />
                  </div>
                  <div className="ml-3">
                    <Title className="text-base">SQLite Persistence</Title>
                    <Text className="text-xs">Local database for data persistence</Text>
                  </div>
                </Flex>
                <Switch checked={sqliteEnabled} onChange={setSqliteEnabled} />
              </Flex>

              {sqliteEnabled ? (
                <>
                  <Grid numItemsSm={2} numItemsLg={4} className="mb-4 gap-4">
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
                      <Flex className="mt-2 items-center gap-2">
                        <Switch checked={sqliteSynchronous} onChange={setSqliteSynchronous} />
                        <Text className="text-sm text-zinc-400">
                          {sqliteSynchronous ? 'NORMAL' : 'OFF'}
                        </Text>
                      </Flex>
                    </div>
                  </Grid>

                  {sqliteStatus === 'error' && sqliteError && (
                    <div className="info-box warning mb-4">
                      <X className="h-4 w-4" />
                      <Text>{sqliteError}</Text>
                    </div>
                  )}

                  {sqliteStatus === 'success' && (
                    <div className="info-box success mb-4">
                      <Check className="h-4 w-4" />
                      <Text>Configuration saved. Restart server to apply changes.</Text>
                    </div>
                  )}

                  <Button
                    size="xs"
                    icon={Save}
                    onClick={handleSaveSqlite}
                    loading={sqliteStatus === 'saving'}
                  >
                    Save Configuration
                  </Button>

                  {settings?.sqlite?.enabled && (
                    <>
                      <Divider className="my-4" />
                      <Flex alignItems="center" justifyContent="between" className="mb-3">
                        <Text className="text-sm font-medium text-zinc-300">
                          Database Statistics
                        </Text>
                        <Flex className="gap-2">
                          <Button
                            size="xs"
                            variant="secondary"
                            icon={Download}
                            onClick={handleExportSqlite}
                            loading={isExporting}
                          >
                            Export
                          </Button>
                          <label className="inline-flex">
                            <input
                              ref={sqliteFileInputRef}
                              type="file"
                              accept=".db,.sqlite,.sqlite3"
                              onChange={handleRestoreSqlite}
                              className="hidden"
                              disabled={isSqliteRestoring}
                            />
                            <Button
                              size="xs"
                              variant="secondary"
                              icon={Upload}
                              loading={isSqliteRestoring}
                              onClick={(e) => {
                                const input = (e.target as HTMLElement)
                                  .closest('label')
                                  ?.querySelector('input');
                                input?.click();
                              }}
                            >
                              Restore
                            </Button>
                          </label>
                        </Flex>
                      </Flex>
                      {sqliteRestoreError && (
                        <div className="info-box warning mb-4">
                          <X className="h-4 w-4" />
                          <Text>{sqliteRestoreError}</Text>
                        </div>
                      )}
                      {sqliteRestoreSuccess && (
                        <div className="info-box success mb-4">
                          <Check className="h-4 w-4" />
                          <Text>Database restored. Restart server to apply changes.</Text>
                        </div>
                      )}
                      <div className="settings-grid compact">
                        <div className="setting-item">
                          <span className="setting-label">Status</span>
                          <Badge color="emerald">Active</Badge>
                        </div>
                        <div className="setting-item">
                          <span className="setting-label">Path</span>
                          <span className="setting-value mono text-sm">
                            {settings.sqlite.path || 'flashq.db'}
                          </span>
                        </div>
                        <div className="setting-item">
                          <span className="setting-label">File Size</span>
                          <span className="setting-value mono text-sm">
                            {sqliteStats ? `${sqliteStats.file_size_mb.toFixed(2)} MB` : '-'}
                          </span>
                        </div>
                        <div className="setting-item">
                          <span className="setting-label">Total Jobs</span>
                          <span className="setting-value mono text-sm">
                            {sqliteStats ? sqliteStats.total_jobs.toLocaleString() : '-'}
                          </span>
                        </div>
                        <div className="setting-item">
                          <span className="setting-label">Queued</span>
                          <Badge color="cyan">
                            {sqliteStats?.queued_jobs?.toLocaleString() || '0'}
                          </Badge>
                        </div>
                        <div className="setting-item">
                          <span className="setting-label">Processing</span>
                          <Badge color="blue">
                            {sqliteStats?.processing_jobs?.toLocaleString() || '0'}
                          </Badge>
                        </div>
                        <div className="setting-item">
                          <span className="setting-label">Delayed</span>
                          <Badge color="amber">
                            {sqliteStats?.delayed_jobs?.toLocaleString() || '0'}
                          </Badge>
                        </div>
                        <div className="setting-item">
                          <span className="setting-label">Failed (DLQ)</span>
                          <Badge color="rose">
                            {sqliteStats?.failed_jobs?.toLocaleString() || '0'}
                          </Badge>
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

                      {sqliteStats?.async_writer_enabled && (
                        <>
                          <Divider className="my-4" />
                          <Flex alignItems="center" justifyContent="between" className="mb-3">
                            <Text className="text-sm font-medium text-zinc-300">
                              Async Writer (High Performance Mode)
                            </Text>
                            <Badge color="emerald">Active</Badge>
                          </Flex>
                          <div className="settings-grid compact mb-4">
                            <div className="setting-item">
                              <span className="setting-label">Queue Length</span>
                              <span className="setting-value mono text-sm">
                                {sqliteStats.async_writer_queue_len.toLocaleString()}
                              </span>
                            </div>
                            <div className="setting-item">
                              <span className="setting-label">Ops Queued</span>
                              <span className="setting-value mono text-sm">
                                {sqliteStats.async_writer_ops_queued.toLocaleString()}
                              </span>
                            </div>
                            <div className="setting-item">
                              <span className="setting-label">Ops Written</span>
                              <span className="setting-value mono text-sm">
                                {sqliteStats.async_writer_ops_written.toLocaleString()}
                              </span>
                            </div>
                            <div className="setting-item">
                              <span className="setting-label">Batches Written</span>
                              <span className="setting-value mono text-sm">
                                {sqliteStats.async_writer_batches_written.toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <Text className="mb-3 text-xs text-zinc-500">
                            Configure write batching (lower interval = faster persistence, higher
                            CPU)
                          </Text>
                          <Grid numItemsSm={2} className="mb-4 gap-3">
                            <div className="form-group">
                              <label className="form-label">Batch Interval (ms)</label>
                              <NumberInput
                                value={asyncBatchInterval}
                                onValueChange={setAsyncBatchInterval}
                                min={10}
                                max={5000}
                                step={10}
                              />
                            </div>
                            <div className="form-group">
                              <label className="form-label">Max Batch Size</label>
                              <NumberInput
                                value={asyncMaxBatchSize}
                                onValueChange={setAsyncMaxBatchSize}
                                min={10}
                                max={10000}
                                step={100}
                              />
                            </div>
                          </Grid>
                          {asyncWriterStatus === 'success' && (
                            <div className="info-box success mb-4">
                              <Check className="h-4 w-4" />
                              <Text>Async writer configuration updated</Text>
                            </div>
                          )}
                          <Button
                            size="xs"
                            icon={Save}
                            onClick={handleSaveAsyncWriter}
                            loading={asyncWriterSaving}
                          >
                            Update Async Writer
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="info-box">
                  <AlertCircle className="h-4 w-4" />
                  <div>
                    <Text className="font-medium">Persistence Disabled</Text>
                    <Text className="mt-1 text-sm">
                      Enable the toggle above to configure SQLite persistence. Without persistence,
                      data will be lost on restart.
                    </Text>
                  </div>
                </div>
              )}
            </Card>
          </TabPanel>

          {/* BACKUP TAB */}
          <TabPanel>
            <Card className="settings-card">
              <Flex alignItems="center" justifyContent="between" className="mb-6">
                <Flex alignItems="center">
                  <div className="card-icon blue">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div className="ml-3">
                    <Title className="text-base">S3 Backup</Title>
                    <Text className="text-xs">Remote backup to S3-compatible storage</Text>
                  </div>
                </Flex>
                <Switch checked={s3Enabled} onChange={setS3Enabled} />
              </Flex>

              {s3Enabled ? (
                <>
                  <Grid numItemsSm={2} numItemsLg={3} className="mb-4 gap-4">
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
                        placeholder="Secret key"
                        value={s3SecretKey}
                        onChange={(e) => setS3SecretKey(e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Interval (sec)</label>
                      <NumberInput
                        value={s3Interval}
                        onValueChange={setS3Interval}
                        min={60}
                        step={60}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Keep Count</label>
                      <NumberInput
                        value={s3KeepCount}
                        onValueChange={setS3KeepCount}
                        min={1}
                        max={100}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Compression</label>
                      <Flex className="mt-2 items-center gap-2">
                        <Switch checked={s3Compress} onChange={setS3Compress} />
                        <Text className="text-sm text-zinc-400">
                          {s3Compress ? 'Enabled' : 'Disabled'}
                        </Text>
                      </Flex>
                    </div>
                  </Grid>

                  {s3Status === 'error' && s3Error && (
                    <div className="info-box warning mb-4">
                      <X className="h-4 w-4" />
                      <Text>{s3Error}</Text>
                    </div>
                  )}

                  {s3Status === 'success' && (
                    <div className="info-box success mb-4">
                      <Check className="h-4 w-4" />
                      <Text>S3 configuration saved successfully!</Text>
                    </div>
                  )}

                  <Flex className="mb-6 gap-2">
                    <Button
                      size="xs"
                      variant="secondary"
                      icon={TestTube}
                      onClick={handleTestS3}
                      loading={s3Status === 'testing'}
                      disabled={
                        !s3Endpoint ||
                        !s3Bucket ||
                        (!s3AccessKey && !settings?.s3_backup?.enabled) ||
                        (!s3SecretKey && !settings?.s3_backup?.enabled)
                      }
                    >
                      Test Connection
                    </Button>
                    <Button
                      size="xs"
                      icon={Save}
                      onClick={handleSaveS3}
                      loading={s3Status === 'saving'}
                      disabled={
                        !s3Enabled && (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey)
                      }
                    >
                      Save
                    </Button>
                  </Flex>
                  {settings?.s3_backup?.enabled && !s3AccessKey && (
                    <Text className="mb-4 text-xs text-zinc-500">
                      Credentials already saved. Leave blank to keep existing.
                    </Text>
                  )}

                  <Divider className="my-4" />

                  <Flex alignItems="center" justifyContent="between" className="mb-4">
                    <Text className="font-medium text-white">Available Backups</Text>
                    <Flex className="gap-2">
                      <Button size="xs" icon={Upload} onClick={triggerBackup} loading={isBackingUp}>
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
                              <span className="font-mono text-white">
                                {backup.key.split('/').pop()}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="font-mono text-zinc-400">
                                {formatBytes(backup.size)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="text-zinc-400">
                                {backup.last_modified
                                  ? formatRelativeTime(backup.last_modified)
                                  : '-'}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="xs"
                                variant="secondary"
                                icon={Download}
                                onClick={() => handleRestoreBackup(backup.key)}
                                loading={isRestoring}
                              >
                                Restore
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="py-6 text-center text-zinc-500">
                      <HardDrive className="mx-auto mb-2 h-8 w-8 opacity-50" />
                      <Text>No backups found. Click "Refresh" to load.</Text>
                    </div>
                  )}
                </>
              ) : (
                <div className="info-box">
                  <Cloud className="h-4 w-4" />
                  <div>
                    <Text className="font-medium">S3 Backup Disabled</Text>
                    <Text className="mt-1 text-sm">
                      Enable the toggle above and configure your S3-compatible storage credentials.
                    </Text>
                  </div>
                </div>
              )}
            </Card>
          </TabPanel>

          {/* SECURITY TAB */}
          <TabPanel>
            <Card className="settings-card">
              <Flex alignItems="center" className="mb-6">
                <div className="card-icon violet">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="ml-3">
                  <Title className="text-base">Authentication</Title>
                  <Text className="text-xs">Configure access control settings</Text>
                </div>
              </Flex>

              <div className="form-group mb-4">
                <label className="form-label">Auth Tokens (comma-separated)</label>
                <TextInput
                  placeholder="token1, token2, token3"
                  value={authTokens}
                  onChange={(e) => setAuthTokens(e.target.value)}
                />
                <Text className="mt-1 text-xs text-zinc-500">
                  Leave empty to disable authentication.
                </Text>
              </div>

              <Button size="xs" icon={Save} onClick={handleSaveAuth} loading={authSaving}>
                Save Auth
              </Button>

              <Divider className="my-4" />

              <Text className="mb-3 text-sm font-medium text-zinc-300">Security Status</Text>
              <div className="settings-grid compact">
                <div className="setting-item">
                  <span className="setting-label">Token Auth</span>
                  <Badge color={settings?.auth_enabled ? 'emerald' : 'zinc'}>
                    {settings?.auth_enabled ? `Enabled (${settings.auth_token_count})` : 'Disabled'}
                  </Badge>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Webhook Signatures</span>
                  <Badge color="emerald">HMAC-SHA256</Badge>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Max Payload</span>
                  <span className="setting-value mono">10 MB</span>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Rate Limiting</span>
                  <Badge color="emerald">Per-Queue</Badge>
                </div>
              </div>
            </Card>
          </TabPanel>

          {/* ADVANCED TAB */}
          <TabPanel>
            <Card className="settings-card danger-zone">
              <Flex alignItems="center" className="mb-6">
                <div
                  className="card-icon"
                  style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}
                >
                  <AlertCircle className="h-5 w-5" />
                </div>
                <div className="ml-3">
                  <Title className="text-base">Danger Zone</Title>
                  <Text className="text-xs">Irreversible operations - use with caution</Text>
                </div>
              </Flex>

              <div className="space-y-3">
                <Flex
                  alignItems="center"
                  justifyContent="between"
                  className="rounded-lg bg-zinc-800/50 p-3"
                >
                  <div>
                    <Text className="font-medium">Clear All Queues</Text>
                    <Text className="text-xs text-zinc-500">
                      Remove all pending jobs from all queues
                    </Text>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    color="rose"
                    icon={Trash2}
                    onClick={handleClearQueues}
                  >
                    Clear
                  </Button>
                </Flex>

                <Flex
                  alignItems="center"
                  justifyContent="between"
                  className="rounded-lg bg-zinc-800/50 p-3"
                >
                  <div>
                    <Text className="font-medium">Clear DLQ</Text>
                    <Text className="text-xs text-zinc-500">
                      Remove all failed jobs from dead letter queue
                    </Text>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    color="rose"
                    icon={Trash2}
                    onClick={handleClearDlq}
                  >
                    Clear
                  </Button>
                </Flex>

                <Flex
                  alignItems="center"
                  justifyContent="between"
                  className="rounded-lg bg-zinc-800/50 p-3"
                >
                  <div>
                    <Text className="font-medium">Clear Completed Jobs</Text>
                    <Text className="text-xs text-zinc-500">Remove all completed job records</Text>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    color="rose"
                    icon={Trash2}
                    onClick={handleClearCompleted}
                  >
                    Clear
                  </Button>
                </Flex>

                <Flex
                  alignItems="center"
                  justifyContent="between"
                  className="rounded-lg bg-zinc-800/50 p-3"
                >
                  <div>
                    <Text className="font-medium">Reset Metrics</Text>
                    <Text className="text-xs text-zinc-500">Clear all historical metrics data</Text>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    color="rose"
                    icon={RotateCcw}
                    onClick={handleResetMetrics}
                  >
                    Reset
                  </Button>
                </Flex>

                <Divider className="my-4" />

                <Flex
                  alignItems="center"
                  justifyContent="between"
                  className="rounded-lg border border-red-900/50 bg-red-900/20 p-3"
                >
                  <div>
                    <Text className="font-medium text-rose-400">Restart Server</Text>
                    <Text className="text-xs text-zinc-500">
                      Restart the flashQ server (connections will be dropped)
                    </Text>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    color="rose"
                    icon={RotateCcw}
                    onClick={handleRestartServer}
                  >
                    Restart
                  </Button>
                </Flex>

                <Flex
                  alignItems="center"
                  justifyContent="between"
                  className="rounded-lg border border-red-900/50 bg-red-900/20 p-3"
                >
                  <div>
                    <Text className="font-medium text-rose-400">Shutdown Server</Text>
                    <Text className="text-xs text-zinc-500">
                      Completely stop the server (manual restart required)
                    </Text>
                  </div>
                  <Button
                    size="xs"
                    variant="secondary"
                    color="rose"
                    icon={Power}
                    onClick={handleShutdownServer}
                  >
                    Shutdown
                  </Button>
                </Flex>

                <Flex
                  alignItems="center"
                  justifyContent="between"
                  className="rounded-lg border border-red-800 bg-red-900/30 p-3"
                >
                  <div>
                    <Text className="font-bold text-rose-400">Factory Reset</Text>
                    <Text className="text-xs text-zinc-500">
                      Delete ALL data and reset server to factory defaults
                    </Text>
                  </div>
                  <Button size="xs" color="rose" icon={AlertCircle} onClick={handleResetServer}>
                    Factory Reset
                  </Button>
                </Flex>
              </div>
            </Card>
          </TabPanel>
        </TabPanels>
      </TabGroup>

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        isLoading={isConfirmLoading}
        confirmText={confirmModal.confirmText}
      />
    </div>
  );
}
