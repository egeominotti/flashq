import { useState } from 'react';
import {
  Card,
  Title,
  Text,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Badge,
  Button,
  Flex,
  TextInput,
} from '@tremor/react';
import { Plus, Trash2, RefreshCw, Clock, HelpCircle, Wifi, WifiOff } from 'lucide-react';
import { useDashboardWebSocket, useToast } from '../hooks';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils';
import { SkeletonTable } from '../components/common/Skeleton';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { Tooltip } from '../components/common/Tooltip';
import type { CronJob } from '../api/types';
import './Crons.css';

export function Crons() {
  const { showToast } = useToast();

  // WebSocket for real-time cron data
  const { isConnected, crons: cronsData, reconnect } = useDashboardWebSocket();

  const [showAddModal, setShowAddModal] = useState(false);
  const [newCron, setNewCron] = useState({
    name: '',
    queue: '',
    schedule: '',
    data: '{}',
  });

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    cronName: string;
  }>({
    isOpen: false,
    cronName: '',
  });
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);

  const crons: CronJob[] = cronsData || [];

  const handleAddCron = async () => {
    if (!newCron.name || !newCron.queue || !newCron.schedule) {
      showToast('Please fill in all required fields', 'warning');
      return;
    }

    try {
      JSON.parse(newCron.data);
    } catch {
      showToast('Invalid JSON in data field', 'error');
      return;
    }

    try {
      await api.addCron(newCron.name, {
        queue: newCron.queue,
        schedule: newCron.schedule,
        data: JSON.parse(newCron.data),
      });
      showToast(`Cron job "${newCron.name}" created`, 'success');
      setShowAddModal(false);
      setNewCron({ name: '', queue: '', schedule: '', data: '{}' });
      // WebSocket will push updated crons automatically
    } catch {
      showToast('Failed to add cron job', 'error');
    }
  };

  const handleDeleteCron = (name: string) => {
    setConfirmModal({
      isOpen: true,
      cronName: name,
    });
  };

  const confirmDeleteCron = async () => {
    setIsConfirmLoading(true);
    try {
      await api.deleteCron(confirmModal.cronName);
      showToast(`Cron job "${confirmModal.cronName}" deleted`, 'success');
      // WebSocket will push updated crons automatically
    } catch {
      showToast('Failed to delete cron job', 'error');
    } finally {
      setIsConfirmLoading(false);
      setConfirmModal({ isOpen: false, cronName: '' });
    }
  };

  const handleRefresh = () => {
    reconnect();
    showToast('WebSocket reconnected', 'info');
  };

  return (
    <div className="crons-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Cron Jobs</Title>
          <Text className="page-subtitle">Real-time scheduled jobs via WebSocket</Text>
        </div>
        <Flex className="gap-3">
          <Badge size="lg" color={isConnected ? 'emerald' : 'rose'}>
            {isConnected ? (
              <>
                <Wifi className="mr-1 h-4 w-4" />
                Connected
              </>
            ) : (
              <>
                <WifiOff className="mr-1 h-4 w-4" />
                Disconnected
              </>
            )}
          </Badge>
          <Button icon={RefreshCw} variant="secondary" onClick={handleRefresh}>
            Reconnect
          </Button>
          <Button icon={Plus} onClick={() => setShowAddModal(true)}>
            Add Cron Job
          </Button>
        </Flex>
      </header>

      <Card className="crons-card">
        {!isConnected && crons.length === 0 ? (
          <SkeletonTable rows={5} columns={7} />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Queue</TableHeaderCell>
                <TableHeaderCell>Schedule</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Last Run</TableHeaderCell>
                <TableHeaderCell>Next Run</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {crons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="py-12 text-center">
                      <Clock className="mx-auto mb-4 h-12 w-12 text-zinc-600" />
                      <Text className="mb-2 text-lg font-medium text-zinc-400">
                        No cron jobs configured
                      </Text>
                      <Text className="mb-4 text-zinc-500">
                        Create a scheduled job to automate recurring tasks
                      </Text>
                      <Button icon={Plus} onClick={() => setShowAddModal(true)}>
                        Add Your First Cron Job
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                crons.map((cron) => (
                  <TableRow key={cron.name}>
                    <TableCell>
                      <span className="font-mono font-semibold text-white">{cron.name}</span>
                    </TableCell>
                    <TableCell>
                      <Badge color="cyan">{cron.queue}</Badge>
                    </TableCell>
                    <TableCell>
                      <Tooltip content="Cron format: second minute hour day month weekday">
                        <code className="rounded bg-zinc-800 px-2 py-1 font-mono text-xs">
                          {cron.schedule}
                        </code>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <Badge color={cron.enabled ? 'emerald' : 'zinc'}>
                        {cron.enabled ? 'Active' : 'Paused'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-zinc-400">
                        {cron.last_run ? formatRelativeTime(cron.last_run) : 'Never'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-zinc-400">
                        {cron.next_run ? formatRelativeTime(cron.next_run) : '-'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Tooltip content="Delete this cron job">
                        <Button
                          size="xs"
                          variant="secondary"
                          color="rose"
                          icon={Trash2}
                          onClick={() => handleDeleteCron(cron.name)}
                        >
                          Delete
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Add Cron Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <Title>Add Cron Job</Title>
              <button onClick={() => setShowAddModal(false)} className="close-btn">
                &times;
              </button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label className="form-label">Name</label>
                <TextInput
                  placeholder="my-cron-job"
                  value={newCron.name}
                  onChange={(e) => setNewCron({ ...newCron, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Queue</label>
                <TextInput
                  placeholder="default"
                  value={newCron.queue}
                  onChange={(e) => setNewCron({ ...newCron, queue: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">
                  Schedule (cron expression)
                  <Tooltip content="6-field format: second minute hour day month weekday">
                    <HelpCircle size={14} className="ml-1 inline text-zinc-500" />
                  </Tooltip>
                </label>
                <TextInput
                  placeholder="0 * * * * *"
                  value={newCron.schedule}
                  onChange={(e) => setNewCron({ ...newCron, schedule: e.target.value })}
                />
                <Text className="form-hint">
                  Examples: <code>0 * * * * *</code> (every minute), <code>0 0 * * * *</code> (every
                  hour), <code>0 0 0 * * *</code> (daily at midnight)
                </Text>
              </div>
              <div className="form-group">
                <label className="form-label">Job Data (JSON)</label>
                <textarea
                  className="form-textarea"
                  placeholder="{}"
                  value={newCron.data}
                  onChange={(e) => setNewCron({ ...newCron, data: e.target.value })}
                  rows={4}
                />
              </div>
            </div>
            <div className="modal-footer">
              <Button variant="secondary" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleAddCron}>Create Cron Job</Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, cronName: '' })}
        onConfirm={confirmDeleteCron}
        title="Delete Cron Job"
        message={`Are you sure you want to delete the cron job "${confirmModal.cronName}"? This action cannot be undone.`}
        variant="danger"
        isLoading={isConfirmLoading}
        confirmText="Delete"
      />
    </div>
  );
}
