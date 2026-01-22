import {
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Badge,
  Button,
  Flex,
  Text,
} from '@tremor/react';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Calendar,
  Eye,
  RotateCcw,
  Trash2,
  History,
} from 'lucide-react';
import { formatRelativeTime } from '../../utils';
import type { Job } from '../../api/types';

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

interface JobsTableProps {
  jobs: Job[];
  onViewJob: (job: Job) => void;
  onRetry: (queueName: string, jobId: number) => void;
  onCancel: (jobId: number) => void;
}

export function JobsTable({ jobs, onViewJob, onRetry, onCancel }: JobsTableProps) {
  if (jobs.length === 0) {
    return (
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
          <TableRow>
            <TableCell colSpan={7}>
              <div className="py-8 text-center">
                <Text>No jobs found</Text>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  return (
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
        {jobs.map((job: Job) => {
          const state = job.state || 'unknown';
          const config = stateConfig[state] || {
            label: state,
            color: 'zinc' as const,
          };
          return (
            <TableRow key={job.id} className="job-row">
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
                    icon={History}
                    onClick={() => onViewJob(job)}
                  >
                    Journey
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={Eye}
                    onClick={() => onViewJob(job)}
                  >
                    View
                  </Button>
                  {state === 'failed' && (
                    <Button
                      size="xs"
                      variant="secondary"
                      icon={RotateCcw}
                      onClick={() => onRetry(job.queue, job.id)}
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
                      onClick={() => onCancel(job.id)}
                    >
                      Cancel
                    </Button>
                  )}
                </Flex>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
