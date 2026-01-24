import { Card, Title, Text, Button, Flex, Divider } from '@tremor/react';
import { AlertCircle, Trash2, RotateCcw, Power } from 'lucide-react';
import { api } from '../../api/client';
import { useToast } from '../../hooks';
import type { ConfirmModalState } from './types';

interface Props {
  onRefetch: () => void;
  setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
}

export function DangerZoneTab({ onRefetch, setConfirmModal }: Props) {
  const { showToast } = useToast();

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
        onRefetch();
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
        onRefetch();
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
        onRefetch();
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
        onRefetch();
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
        onRefetch();
      },
    });
  };

  return (
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
  );
}
