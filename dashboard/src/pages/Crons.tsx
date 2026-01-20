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
import {
  Plus,
  Trash2,
  RefreshCw,
  Clock,
} from 'lucide-react';
import { useCrons } from '../hooks';
import { api } from '../api/client';
import { formatRelativeTime } from '../utils';
import './Crons.css';

interface CronJob {
  name: string;
  queue: string;
  schedule: string;
  data?: any;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
}

export function Crons() {
  const { data: cronsData, refetch } = useCrons();
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCron, setNewCron] = useState({
    name: '',
    queue: '',
    schedule: '',
    data: '{}',
  });

  const crons: CronJob[] = cronsData?.crons || [];

  const handleAddCron = async () => {
    try {
      await api.addCron(newCron.name, {
        queue: newCron.queue,
        schedule: newCron.schedule,
        data: JSON.parse(newCron.data),
      });
      setShowAddModal(false);
      setNewCron({ name: '', queue: '', schedule: '', data: '{}' });
      refetch();
    } catch (error) {
      console.error('Failed to add cron:', error);
    }
  };

  const handleDeleteCron = async (name: string) => {
    if (confirm(`Are you sure you want to delete cron job "${name}"?`)) {
      await api.deleteCron(name);
      refetch();
    }
  };

  return (
    <div className="crons-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Cron Jobs</Title>
          <Text className="page-subtitle">
            Manage scheduled jobs and recurring tasks
          </Text>
        </div>
        <Flex className="gap-3">
          <Button
            icon={RefreshCw}
            variant="secondary"
            onClick={() => refetch()}
          >
            Refresh
          </Button>
          <Button
            icon={Plus}
            onClick={() => setShowAddModal(true)}
          >
            Add Cron Job
          </Button>
        </Flex>
      </header>

      <Card className="crons-card">
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
                  <div className="text-center py-12">
                    <Clock className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
                    <Text className="text-lg font-medium text-zinc-400 mb-2">
                      No cron jobs configured
                    </Text>
                    <Text className="text-zinc-500 mb-4">
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
                    <span className="font-mono font-semibold text-white">
                      {cron.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge color="cyan">{cron.queue}</Badge>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs bg-zinc-800 px-2 py-1 rounded font-mono">
                      {cron.schedule}
                    </code>
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
                    <Button
                      size="xs"
                      variant="secondary"
                      color="rose"
                      icon={Trash2}
                      onClick={() => handleDeleteCron(cron.name)}
                    >
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
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
                <label className="form-label">Schedule (cron expression)</label>
                <TextInput
                  placeholder="0 * * * * *"
                  value={newCron.schedule}
                  onChange={(e) => setNewCron({ ...newCron, schedule: e.target.value })}
                />
                <Text className="form-hint">
                  Format: second minute hour day month weekday
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
              <Button onClick={handleAddCron}>
                Create Cron Job
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
