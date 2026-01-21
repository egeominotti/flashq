import { useState, useMemo } from 'react';
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
  X,
} from 'lucide-react';
import { useJobs, useQueues, useToast } from '../hooks';
import { api } from '../api/client';
import { formatNumber, formatRelativeTime } from '../utils';
import { SkeletonTable } from '../components/common/Skeleton';
import { ConfirmModal } from '../components/common/ConfirmModal';
import { Pagination } from '../components/common/Pagination';
import { Tooltip } from '../components/common/Tooltip';
import type { Queue, Job } from '../api/types';
import './Jobs.css';

type JobState = 'all' | 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

const stateConfig: Record<
  string,
  {
    label: string;
    color: 'cyan' | 'blue' | 'emerald' | 'rose' | 'amber' | 'zinc';
    icon: typeof Clock;
  }
> = {
  waiting: { label: 'Waiting', color: 'cyan', icon: Clock },
  active: { label: 'Active', color: 'blue', icon: Loader2 },
  completed: { label: 'Completed', color: 'emerald', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'rose', icon: XCircle },
  delayed: { label: 'Delayed', color: 'amber', icon: Calendar },
};

export function Jobs() {
  const { showToast } = useToast();
  const { data: queuesData, refetch: refetchQueues, isLoading: queuesLoading } = useQueues();
  const [selectedQueue, setSelectedQueue] = useState('');
  const [selectedState, setSelectedState] = useState<JobState>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => Promise<void>;
    variant: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: async () => {},
    variant: 'danger',
  });
  const [isConfirmLoading, setIsConfirmLoading] = useState(false);

  const queues: Queue[] = queuesData || [];

  const {
    data: jobsData,
    refetch: refetchJobs,
    isLoading: jobsLoading,
  } = useJobs(selectedQueue || undefined, selectedState === 'all' ? undefined : selectedState, 500);

  const jobs = useMemo(() => jobsData?.jobs || [], [jobsData]);

  const filteredJobs = useMemo(() => {
    return jobs.filter(
      (job: Job) =>
        job.id?.toString().includes(searchTerm) ||
        job.custom_id?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [jobs, searchTerm]);

  // Pagination
  const totalItems = filteredJobs.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredJobs.slice(start, start + pageSize);
  }, [filteredJobs, currentPage, pageSize]);

  // Reset page when filters change
  const handleFilterChange = () => {
    setCurrentPage(1);
  };

  const handleRetry = async (queueName: string, jobId: number) => {
    try {
      await api.retryJob(queueName, jobId);
      showToast('Job queued for retry', 'success');
      refetchJobs();
      refetchQueues();
    } catch {
      showToast('Failed to retry job', 'error');
    }
  };

  const handleCancel = (jobId: number) => {
    setConfirmModal({
      isOpen: true,
      title: 'Cancel Job',
      message: `Are you sure you want to cancel job #${jobId}? This action cannot be undone.`,
      variant: 'danger',
      onConfirm: async () => {
        try {
          await api.cancelJob(jobId);
          showToast('Job cancelled successfully', 'success');
          refetchJobs();
          refetchQueues();
        } catch {
          showToast('Failed to cancel job', 'error');
        }
      },
    });
  };

  const handleConfirm = async () => {
    setIsConfirmLoading(true);
    try {
      await confirmModal.onConfirm();
    } finally {
      setIsConfirmLoading(false);
      setConfirmModal((prev) => ({ ...prev, isOpen: false }));
    }
  };

  const handleRefresh = () => {
    refetchJobs();
    refetchQueues();
    showToast('Data refreshed', 'info');
  };

  const isLoading = queuesLoading || jobsLoading;

  return (
    <div className="jobs-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Jobs Browser</Title>
          <Text className="page-subtitle">Browse and manage jobs across all queues</Text>
        </div>
        <Button icon={RefreshCw} variant="secondary" onClick={handleRefresh}>
          Refresh
        </Button>
      </header>

      <Card className="jobs-card">
        {/* Filters */}
        <Flex className="mb-6 flex-wrap gap-4">
          <Select
            value={selectedQueue}
            onValueChange={(v) => {
              setSelectedQueue(v);
              handleFilterChange();
            }}
            placeholder="All Queues"
            className="max-w-xs"
          >
            <SelectItem value="">All Queues</SelectItem>
            {queues.map((q: Queue) => (
              <SelectItem key={q.name} value={q.name}>
                {q.name}
              </SelectItem>
            ))}
          </Select>

          <Select
            value={selectedState}
            onValueChange={(v) => {
              setSelectedState(v as JobState);
              handleFilterChange();
            }}
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
            onChange={(e) => {
              setSearchTerm(e.target.value);
              handleFilterChange();
            }}
            className="max-w-xs"
          />
        </Flex>

        {/* State Tabs Summary */}
        <div className="state-summary mb-6">
          <Flex className="gap-3">
            {Object.entries(stateConfig).map(([state, config]) => {
              let count = 0;
              const relevantQueues = selectedQueue
                ? queues.filter((q: Queue) => q.name === selectedQueue)
                : queues;

              for (const queue of relevantQueues) {
                if (state === 'waiting') count += queue.pending || 0;
                else if (state === 'active') count += queue.processing || 0;
                else if (state === 'completed') count += queue.completed || 0;
                else if (state === 'failed') count += queue.dlq || 0;
                else if (state === 'delayed') count += queue.delayed || 0;
              }

              const Icon = config.icon;
              return (
                <Tooltip key={state} content={`Filter by ${config.label.toLowerCase()} jobs`}>
                  <button
                    onClick={() => {
                      setSelectedState(state as JobState);
                      handleFilterChange();
                    }}
                    className={`state-tab ${selectedState === state ? 'active' : ''}`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="state-label">{config.label}</span>
                    <Badge size="xs" color={config.color}>
                      {formatNumber(count)}
                    </Badge>
                  </button>
                </Tooltip>
              );
            })}
          </Flex>
        </div>

        {/* Table */}
        {isLoading ? (
          <SkeletonTable rows={10} columns={7} />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Job ID</TableHeaderCell>
                <TableHeaderCell>Queue</TableHeaderCell>
                <TableHeaderCell>State</TableHeaderCell>
                <TableHeaderCell>Priority</TableHeaderCell>
                <TableHeaderCell>Attempts</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedJobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <div className="py-8 text-center">
                      <Text>No jobs found</Text>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                paginatedJobs.map((job: Job) => {
                  const state = job.state || 'unknown';
                  const config = stateConfig[state] || { label: state, color: 'zinc' as const };
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <span className="font-mono text-white">{job.id}</span>
                      </TableCell>
                      <TableCell>
                        <Badge size="xs" color="cyan">
                          {job.queue}
                        </Badge>
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
                              onClick={() => handleRetry(job.queue, job.id)}
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
        )}

        {/* Pagination */}
        {!isLoading && totalItems > 0 && (
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setCurrentPage(1);
            }}
          />
        )}
      </Card>

      {/* Job Detail Modal */}
      {selectedJob && (
        <div className="job-modal-overlay" onClick={() => setSelectedJob(null)}>
          <div className="job-modal" onClick={(e) => e.stopPropagation()}>
            <div className="job-modal-header">
              <Title>Job Details</Title>
              <button onClick={() => setSelectedJob(null)} className="close-btn">
                <X size={20} />
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
                <Badge
                  color={
                    selectedJob.state ? stateConfig[selectedJob.state]?.color || 'zinc' : 'zinc'
                  }
                >
                  {selectedJob.state || 'unknown'}
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
                <pre className="job-data-preview">{JSON.stringify(selectedJob.data, null, 2)}</pre>
              </div>
              {selectedJob.result !== undefined && selectedJob.result !== null && (
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
                  <pre className="job-data-preview error">{selectedJob.error}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        variant={confirmModal.variant}
        isLoading={isConfirmLoading}
        confirmText="Cancel Job"
      />
    </div>
  );
}
