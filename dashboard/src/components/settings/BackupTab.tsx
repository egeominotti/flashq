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
  Switch,
  Divider,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
} from '@tremor/react';
import { Cloud, HardDrive, TestTube, Save, Upload, RefreshCw, Download, Check, X } from 'lucide-react';
import { api, type S3SettingsPayload } from '../../api/client';
import { useToast } from '../../hooks';
import { formatRelativeTime, formatBytes } from '../../utils';
import type { S3Backup, ConfirmModalState } from './types';

interface S3Settings {
  enabled?: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  interval_secs?: number;
  keep_count?: number;
  compress?: boolean;
}

interface Settings {
  s3_backup?: S3Settings;
}

interface Props {
  settings: Settings | null;
  onRefetch: () => void;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
}

export function BackupTab({ settings, onRefetch, setConfirmModal }: Props) {
  const { showToast } = useToast();

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

  // Backups
  const [backups, setBackups] = useState<S3Backup[]>([]);
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    if (settings) {
      setS3Enabled(settings.s3_backup?.enabled || false);
      setS3Endpoint(settings.s3_backup?.endpoint || '');
      setS3Bucket(settings.s3_backup?.bucket || '');
      setS3Region(settings.s3_backup?.region || 'auto');
      setS3Interval(settings.s3_backup?.interval_secs || 300);
      setS3KeepCount(settings.s3_backup?.keep_count || 24);
      setS3Compress(settings.s3_backup?.compress ?? true);
    }
  }, [settings]);

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
    const result = await api.saveS3Settings(getS3Payload());
    if (result.ok) {
      setS3Status('success');
      showToast('S3 settings saved', 'success');
      setTimeout(() => onRefetch(), 500);
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
          onRefetch();
        } catch (error) {
          console.error('Failed to restore backup:', error);
          showToast('Failed to restore backup', 'error');
        }
        setIsRestoring(false);
      },
    });
  };

  return (
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
              <NumberInput value={s3Interval} onValueChange={setS3Interval} min={60} step={60} />
            </div>
            <div className="form-group">
              <label className="form-label">Keep Count</label>
              <NumberInput value={s3KeepCount} onValueChange={setS3KeepCount} min={1} max={100} />
            </div>
            <div className="form-group">
              <label className="form-label">Compression</label>
              <Flex className="mt-2 items-center gap-2">
                <Switch checked={s3Compress} onChange={setS3Compress} />
                <Text className="text-sm text-zinc-400">{s3Compress ? 'Enabled' : 'Disabled'}</Text>
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
              disabled={!s3Enabled && (!s3Endpoint || !s3Bucket || !s3AccessKey || !s3SecretKey)}
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
  );
}
