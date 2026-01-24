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
  Switch,
  Divider,
} from '@tremor/react';
import { Database, Download, Upload, AlertCircle, Check, X, Save } from 'lucide-react';
import { api } from '../../api/client';
import { useToast } from '../../hooks';
import type { SqliteStats } from './types';

interface SqliteSettings {
  enabled?: boolean;
  path?: string;
  synchronous?: boolean;
}

interface Settings {
  sqlite?: SqliteSettings;
}

interface Props {
  settings: Settings | null;
  onRefetch: () => void;
}

export function StorageTab({ settings, onRefetch }: Props) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // SQLite Settings
  const [sqliteEnabled, setSqliteEnabled] = useState(false);
  const [sqlitePath, setSqlitePath] = useState('flashq.db');
  const [sqliteSynchronous, setSqliteSynchronous] = useState(true);
  const [sqliteCacheSize, setSqliteCacheSize] = useState(64);
  const [sqliteStatus, setSqliteStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [sqliteError, setSqliteError] = useState('');

  // SQLite Stats
  const [sqliteStats, setSqliteStats] = useState<SqliteStats | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Restore state
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  // Async Writer Config
  const [asyncBatchInterval, setAsyncBatchInterval] = useState(50);
  const [asyncMaxBatchSize, setAsyncMaxBatchSize] = useState(1000);
  const [asyncWriterSaving, setAsyncWriterSaving] = useState(false);
  const [asyncWriterStatus, setAsyncWriterStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (settings) {
      setSqliteEnabled(settings.sqlite?.enabled || false);
      setSqlitePath(settings.sqlite?.path || 'flashq.db');
      setSqliteSynchronous(settings.sqlite?.synchronous ?? true);
    }
  }, [settings]);

  useEffect(() => {
    if (settings?.sqlite?.enabled) {
      api.getSqliteStats().then((stats) => {
        if (stats) {
          setSqliteStats(stats);
          if (stats.async_writer_enabled) {
            setAsyncBatchInterval(stats.async_writer_batch_interval_ms);
            setAsyncMaxBatchSize(stats.async_writer_max_batch_size);
          }
        }
      });
    }
  }, [settings?.sqlite?.enabled]);

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
      showToast('SQLite settings saved. Restart server to apply.', 'success');
      setTimeout(() => onRefetch(), 500);
    } else {
      setSqliteStatus('error');
      setSqliteError(result.error || 'Failed to save');
      showToast('Failed to save SQLite settings', 'error');
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const apiUrl = api.getApiUrl();
      window.open(`${apiUrl}/sqlite/download`, '_blank');
    } finally {
      setIsExporting(false);
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    setRestoreError('');
    setRestoreSuccess(false);

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
        setRestoreSuccess(true);
        showToast('Database restored successfully', 'success');
      } else {
        setRestoreError(result.error || 'Restore failed');
        showToast('Restore failed', 'error');
      }
    } catch (err) {
      setRestoreError(String(err));
      showToast('Restore failed', 'error');
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

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
      const stats = await api.getSqliteStats();
      if (stats) setSqliteStats(stats);
    } else {
      setAsyncWriterStatus('error');
      showToast('Failed to update async writer config', 'error');
    }
  };

  return (
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
                <Text className="text-sm font-medium text-zinc-300">Database Statistics</Text>
                <Flex className="gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={Download}
                    onClick={handleExport}
                    loading={isExporting}
                  >
                    Export
                  </Button>
                  <label className="inline-flex">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".db,.sqlite,.sqlite3"
                      onChange={handleRestore}
                      className="hidden"
                      disabled={isRestoring}
                    />
                    <Button
                      size="xs"
                      variant="secondary"
                      icon={Upload}
                      loading={isRestoring}
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

              {restoreError && (
                <div className="info-box warning mb-4">
                  <X className="h-4 w-4" />
                  <Text>{restoreError}</Text>
                </div>
              )}

              {restoreSuccess && (
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
                    {settings.sqlite?.path || 'flashq.db'}
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
                  <Badge color="cyan">{sqliteStats?.queued_jobs?.toLocaleString() || '0'}</Badge>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Processing</span>
                  <Badge color="blue">
                    {sqliteStats?.processing_jobs?.toLocaleString() || '0'}
                  </Badge>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Delayed</span>
                  <Badge color="amber">{sqliteStats?.delayed_jobs?.toLocaleString() || '0'}</Badge>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Failed (DLQ)</span>
                  <Badge color="rose">{sqliteStats?.failed_jobs?.toLocaleString() || '0'}</Badge>
                </div>
                <div className="setting-item">
                  <span className="setting-label">WAL Mode</span>
                  <Badge color="emerald">Enabled</Badge>
                </div>
                <div className="setting-item">
                  <span className="setting-label">Synchronous</span>
                  <Badge color={settings.sqlite?.synchronous ? 'emerald' : 'amber'}>
                    {settings.sqlite?.synchronous ? 'NORMAL' : 'OFF'}
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
                    Configure write batching (lower interval = faster persistence, higher CPU)
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
              Enable the toggle above to configure SQLite persistence. Without persistence, data
              will be lost on restart.
            </Text>
          </div>
        </div>
      )}
    </Card>
  );
}
