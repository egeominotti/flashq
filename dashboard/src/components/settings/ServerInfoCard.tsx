import { Card, Title, Text, Button, Flex, Badge, Divider } from '@tremor/react';
import { Server, RotateCcw, Power } from 'lucide-react';
import { api } from '../../api/client';
import type { ConfirmModalState } from './types';

interface Settings {
  version?: string;
  tcp_port?: number;
  http_port?: number;
  sqlite?: { enabled?: boolean };
}

interface Props {
  settings: Settings | null;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
}

export function ServerInfoCard({ settings, setConfirmModal }: Props) {
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
      },
    });
  };

  return (
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
        <Button size="xs" variant="secondary" icon={RotateCcw} onClick={handleRestartServer}>
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
  );
}
