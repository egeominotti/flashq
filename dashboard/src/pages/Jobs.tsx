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
  Select,
  SelectItem,
} from '@tremor/react';
import {
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
  Eye,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useJobs, useStats } from '../hooks';
import { api } from '../api/client';
import { formatNumber, formatRelativeTime } from '../utils';
import './Jobs.css';

type JobState = 'all' | 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

const stateConfig: Record<string, { label: string; color: 'cyan' | 'blue' | 'emerald' | 'rose' | 'amber' | 'zinc'; icon: typeof Clock }> = {
  waiting: { label: 'Waiting', color: 'cyan', icon: Clock },
  active: { label: 'Active', color: 'blue', icon: Loader2 },
  completed: { label: 'Completed', color: 'emerald', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'rose', icon: XCircle },
  delayed: { label: 'Delayed', color: 'amber', icon: Calendar },
};

export function Jobs() {
  const { data: stats, refetch: refetchStats } = useStats();
  const [selectedQueue, setSelectedQueue] = useState('');
  const [selectedState, setSelectedState] = useState<JobState>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJob, setSelectedJob] = useState<any>(null);

  const queues = stats?.queues || [];
  const queueName = selectedQueue || queues[0]?.name || '';

  const { data: jobsData, refetch: refetchJobs } = useJobs(
    queueName,
    selectedState === 'all' ? undefined : selectedState,
    50
  );

  const jobs = jobsData?.jobs || [];

  const filteredJobs = jobs.filter((job: any) =>
    job.id?.toString().includes(searchTerm) ||
    job.custom_id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleRetry = async (jobId: string) => {
    await api.retryJob(queueName, jobId);
    refetchJobs();
    refetchStats();
  };

  const handleCancel = async (jobId: number) => {
    if (confirm('Are you sure you want to cancel this job?')) {
      await api.cancelJob(jobId);
      refetchJobs();
      refetchStats();
    }
  };

  const handleRefresh = () => {
    refetchJobs();
    refetchStats();
  };

  return (
    <div className="jobs-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Jobs Browser</Title>
          <Text className="page-subtitle">
            Browse and manage jobs across all queues
          </Text>
        </div>
        <Button
          icon={RefreshCw}
          variant="secondary"
          onClick={handleRefresh}
        >
          Refresh
        </Button>
      </header>

      <Card className="jobs-card">
        {/* Filters */}
        <Flex className="mb-6 gap-4 flex-wrap">
          <Select
            value={selectedQueue}
            onValueChange={setSelectedQueue}
            placeholder="Select queue"
            className="max-w-xs"
          >
            {queues.map((q: any) => (
              <SelectItem key={q.name} value={q.name}>
                {q.name}
              </SelectItem>
            ))}
          </Select>

          <Select
            value={selectedState}
            onValueChange={(v) => setSelectedState(v as JobState)}
            className="max-w-xs"
          >
            <SelectItem value="all">All States</SelectItem>
            <SelectItem value="waiting">Waiting</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="delayed">Delayed</SelectItem>
          </Select>

          <TextInput
            icon={Search}
            placeholder="Search by ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-xs"
          />
        </Flex>

        {/* State Tabs Summary */}
        <div className="state-summary mb-6">
          <Flex className="gap-3">
            {Object.entries(stateConfig).map(([state, config]) => {
              const queue = queues.find((q: any) => q.name === queueName);
              const count = queue ? queue[state as keyof typeof queue] || 0 : 0;
              const Icon = config.icon;
              return (
                <button
                  key={state}
                  onClick={() => setSelectedState(state as JobState)}
                  className={`state-tab ${selectedState === state ? 'active' : ''}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="state-label">{config.label}</span>
                  <Badge size="xs" color={config.color}>
                    {formatNumber(count as number)}
                  </Badge>
                </button>
              );
            })}
          </Flex>
        </div>

        {/* Table */}
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Job ID</TableHeaderCell>
              <TableHeaderCell>Custom ID</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell>Priority</TableHeaderCell>
              <TableHeaderCell>Attempts</TableHeaderCell>
              <TableHeaderCell>Created</TableHeaderCell>
              <TableHeaderCell className="text-right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredJobs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <div className="text-center py-8">
                    <Text>{queueName ? 'No jobs found' : 'Select a queue to view jobs'}</Text>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredJobs.map((job: any) => {
                const state = job.state || 'unknown';
                const config = stateConfig[state] || { label: state, color: 'zinc' as const };
                return (
                  <TableRow key={job.id}>
                    <TableCell>
                      <span className="font-mono text-white">{job.id}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-zinc-400">
                        {job.custom_id || '-'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge color={config.color}>{config.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono">{job.priority || 0}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono">
                        {job.attempts || 0}/{job.max_attempts || 3}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-zinc-400">
                        {job.created_at ? formatRelativeTime(job.created_at) : '-'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Flex justifyContent="end" className="gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          icon={Eye}
                          onClick={() => setSelectedJob(job)}
                        >
                          View
                        </Button>
                        {state === 'failed' && (
                          <Button
                            size="xs"
                            variant="secondary"
                            icon={RotateCcw}
                            onClick={() => handleRetry(job.id)}
                          >
                            Retry
                          </Button>
                        )}
                        {(state === 'waiting' || state === 'delayed') && (
                          <Button
                            size="xs"
                            variant="secondary"
                            color="rose"
                            icon={Trash2}
                            onClick={() => handleCancel(job.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </Flex>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Job count */}
        <Flex className="mt-6 pt-6 border-t border-zinc-800">
          <Text>
            Showing {filteredJobs.length} jobs
          </Text>
        </Flex>
      </Card>

      {/* Job Detail Modal */}
      {selectedJob && (
        <div className="job-modal-overlay" onClick={() => setSelectedJob(null)}>
          <div className="job-modal" onClick={(e) => e.stopPropagation()}>
            <div className="job-modal-header">
              <Title>Job Details</Title>
              <button onClick={() => setSelectedJob(null)} className="close-btn">
                &times;
              </button>
            </div>
            <div className="job-modal-content">
              <div className="job-detail-row">
                <span className="job-detail-label">ID</span>
                <span className="job-detail-value font-mono">{selectedJob.id}</span>
              </div>
              {selectedJob.custom_id && (
                <div className="job-detail-row">
                  <span className="job-detail-label">Custom ID</span>
                  <span className="job-detail-value font-mono">{selectedJob.custom_id}</span>
                </div>
              )}
              <div className="job-detail-row">
                <span className="job-detail-label">State</span>
                <Badge color={stateConfig[selectedJob.state]?.color || 'zinc'}>
                  {selectedJob.state}
                </Badge>
              </div>
              <div className="job-detail-row">
                <span className="job-detail-label">Priority</span>
                <span className="job-detail-value">{selectedJob.priority}</span>
              </div>
              <div className="job-detail-row">
                <span className="job-detail-label">Attempts</span>
                <span className="job-detail-value">
                  {selectedJob.attempts}/{selectedJob.max_attempts}
                </span>
              </div>
              <div className="job-detail-section">
                <span className="job-detail-label">Data</span>
                <pre className="job-data-preview">
                  {JSON.stringify(selectedJob.data, null, 2)}
                </pre>
              </div>
              {selectedJob.result && (
                <div className="job-detail-section">
                  <span className="job-detail-label">Result</span>
                  <pre className="job-data-preview">
                    {JSON.stringify(selectedJob.result, null, 2)}
                  </pre>
                </div>
              )}
              {selectedJob.error && (
                <div className="job-detail-section">
                  <span className="job-detail-label">Error</span>
                  <pre className="job-data-preview error">
                    {selectedJob.error}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
