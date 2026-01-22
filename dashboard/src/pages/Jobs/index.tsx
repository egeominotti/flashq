import { useState, useMemo } from 'react';
import {
  Card,
  Title,
  Text,
  Badge,
  Button,
  TabGroup,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
} from '@tremor/react';
import { RefreshCw, Radio, GitBranch, List, Wifi, WifiOff } from 'lucide-react';
import { useIsConnected, useQueues as useQueuesData, useStats } from '../../stores';
import { useJobs, useToast, useJobEvents } from '../../hooks';
import { api } from '../../api/client';
import {
  SkeletonTable,
  JobFlowVisualization,
  JobTimeline,
  LiveEventFeed,
} from '../../components/common';
import { ConfirmModal } from '../../components/common/ConfirmModal';
import { Pagination } from '../../components/common/Pagination';
import { JobsFilters } from './JobsFilters';
import { JobsTable } from './JobsTable';
import type { Queue, Job } from '../../api/types';
import '../Jobs.css';

type JobState = 'all' | 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

export function Jobs() {
  const { showToast } = useToast();

  // Granular WebSocket hooks - only re-render when needed data changes
  const isConnected = useIsConnected();
  const queuesData = useQueuesData();
  const stats = useStats();

  const [selectedQueue, setSelectedQueue] = useState('');
  const [selectedState, setSelectedState] = useState<JobState>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
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

  // Job list uses polling (paginated, filtered - not suitable for WebSocket)
  const {
    data: jobsData,
    refetch: refetchJobs,
    isLoading: jobsLoading,
  } = useJobs(
    selectedQueue || undefined,
    selectedState === 'all' ? undefined : selectedState,
    5000
  );

  const jobs = useMemo(() => jobsData?.jobs || [], [jobsData]);

  // WebSocket for real-time event display
  const { recentEvents, eventCounts } = useJobEvents({
    queue: selectedQueue || undefined,
  });

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
    showToast('Jobs refreshed', 'info');
  };

  const handleViewJob = (job: Job) => {
    setSelectedJob(job);
    setShowTimeline(true);
  };

  // Flow visualization data from WebSocket stats (real-time) - ensure no negative values
  const flowData = useMemo(() => {
    return {
      waiting: Math.max(0, stats?.queued ?? 0),
      delayed: Math.max(0, stats?.delayed ?? 0),
      active: Math.max(0, stats?.processing ?? 0),
      completed: Math.max(0, stats?.completed ?? 0),
      failed: Math.max(0, stats?.dlq ?? 0),
    };
  }, [stats]);

  const handleStateSelect = (state: string) => {
    setSelectedState(state as JobState);
    handleFilterChange();
  };

  const handleQueueChange = (queue: string) => {
    setSelectedQueue(queue);
    handleFilterChange();
  };

  const handleSearchChange = (term: string) => {
    setSearchTerm(term);
    handleFilterChange();
  };

  return (
    <div className="jobs-page">
      <header className="page-header">
        <div>
          <Title className="page-title">Jobs Browser</Title>
          <Text className="page-subtitle">Real-time job monitoring via WebSocket</Text>
        </div>
        <div className="header-actions">
          <Badge size="lg" color={isConnected ? 'emerald' : 'rose'}>
            {isConnected ? (
              <>
                <Wifi className="mr-1 h-4 w-4" />
                <span className="status-indicator" />
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
            Refresh
          </Button>
        </div>
      </header>

      <TabGroup>
        <TabList className="jobs-tabs mb-6">
          <Tab icon={Radio}>Live</Tab>
          <Tab icon={GitBranch}>Pipeline</Tab>
          <Tab icon={List}>Details</Tab>
        </TabList>

        <TabPanels>
          {/* LIVE TAB */}
          <TabPanel>
            <LiveEventFeed
              isConnected={isConnected}
              recentEvents={recentEvents}
              eventCounts={eventCounts}
            />
          </TabPanel>

          {/* PIPELINE TAB */}
          <TabPanel>
            <JobFlowVisualization
              data={flowData}
              selectedState={selectedState}
              onStateSelect={handleStateSelect}
            />
          </TabPanel>

          {/* DETAILS TAB */}
          <TabPanel>
            <Card className="jobs-card">
              <JobsFilters
                queues={queues}
                selectedQueue={selectedQueue}
                selectedState={selectedState}
                searchTerm={searchTerm}
                onQueueChange={handleQueueChange}
                onStateChange={setSelectedState}
                onSearchChange={handleSearchChange}
              />

              {/* Table */}
              {jobsLoading ? (
                <SkeletonTable rows={10} columns={7} />
              ) : (
                <JobsTable
                  jobs={paginatedJobs}
                  onViewJob={handleViewJob}
                  onRetry={handleRetry}
                  onCancel={handleCancel}
                />
              )}

              {/* Pagination */}
              {!jobsLoading && totalItems > 0 && (
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
          </TabPanel>
        </TabPanels>
      </TabGroup>

      {/* Job Timeline Modal */}
      {selectedJob && showTimeline && (
        <JobTimeline
          job={selectedJob}
          onClose={() => {
            setSelectedJob(null);
            setShowTimeline(false);
          }}
        />
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
