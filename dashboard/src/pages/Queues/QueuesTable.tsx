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
import { Pause, Play, Trash2, CheckSquare, Square } from 'lucide-react';
import { formatNumber } from '../../utils';
import { Tooltip } from '../../components/common/Tooltip';
import type { Queue } from '../../api/types';

// Helper function outside component to avoid recreation on every render
function getQueueStatus(queue: Queue): { label: string; color: 'amber' | 'emerald' | 'blue' | 'zinc' } {
  if (queue.paused) return { label: 'Paused', color: 'amber' };
  if (queue.processing > 0) return { label: 'Active', color: 'emerald' };
  if (queue.pending > 0) return { label: 'Pending', color: 'blue' };
  return { label: 'Idle', color: 'zinc' };
}

interface QueuesTableProps {
  queues: Queue[];
  selectedQueues: Set<string>;
  onToggleSelect: (name: string) => void;
  onToggleSelectAll: () => void;
  onPause: (name: string) => void;
  onResume: (name: string) => void;
  onDrain: (name: string) => void;
}

export function QueuesTable({
  queues,
  selectedQueues,
  onToggleSelect,
  onToggleSelectAll,
  onPause,
  onResume,
  onDrain,
}: QueuesTableProps) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-10">
            <button onClick={onToggleSelectAll} className="select-checkbox">
              {selectedQueues.size === queues.length && queues.length > 0 ? (
                <CheckSquare size={18} className="text-cyan-400" />
              ) : (
                <Square size={18} className="text-zinc-500" />
              )}
            </button>
          </TableHeaderCell>
          <TableHeaderCell>Queue Name</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell className="text-right">Waiting</TableHeaderCell>
          <TableHeaderCell className="text-right">Active</TableHeaderCell>
          <TableHeaderCell className="text-right">Completed</TableHeaderCell>
          <TableHeaderCell className="text-right">Failed</TableHeaderCell>
          <TableHeaderCell className="text-right">Delayed</TableHeaderCell>
          <TableHeaderCell className="text-right">Actions</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {queues.length === 0 ? (
          <TableRow>
            <TableCell colSpan={9}>
              <div className="py-8 text-center">
                <Text>No queues found</Text>
              </div>
            </TableCell>
          </TableRow>
        ) : (
          queues.map((queue) => {
            const status = getQueueStatus(queue);
            const isSelected = selectedQueues.has(queue.name);
            return (
              <TableRow key={queue.name} className={isSelected ? 'selected' : ''}>
                <TableCell>
                  <button
                    onClick={() => onToggleSelect(queue.name)}
                    className="select-checkbox"
                  >
                    {isSelected ? (
                      <CheckSquare size={18} className="text-cyan-400" />
                    ) : (
                      <Square size={18} className="text-zinc-500" />
                    )}
                  </button>
                </TableCell>
                <TableCell>
                  <div className="queue-name">
                    <Text className="font-mono font-semibold text-white">{queue.name}</Text>
                    {queue.rate_limit && (
                      <Tooltip content="Rate limit (jobs per minute)">
                        <Badge size="xs" color="violet">
                          {queue.rate_limit}/min
                        </Badge>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge color={status.color}>{status.label}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Badge color="cyan">{formatNumber(Math.max(0, queue.pending))}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Badge color="blue">{formatNumber(Math.max(0, queue.processing))}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-emerald-400">
                    {formatNumber(Math.max(0, queue.completed ?? 0))}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-rose-400">{formatNumber(Math.max(0, queue.dlq))}</span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-amber-400">
                    {formatNumber(Math.max(0, queue.delayed ?? 0))}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Flex justifyContent="end" className="gap-2">
                    {queue.paused ? (
                      <Tooltip content="Resume processing">
                        <Button
                          size="xs"
                          variant="secondary"
                          icon={Play}
                          onClick={() => onResume(queue.name)}
                        >
                          Resume
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Pause processing">
                        <Button
                          size="xs"
                          variant="secondary"
                          icon={Pause}
                          onClick={() => onPause(queue.name)}
                        >
                          Pause
                        </Button>
                      </Tooltip>
                    )}
                    <Tooltip content="Remove all waiting jobs">
                      <Button
                        size="xs"
                        variant="secondary"
                        color="rose"
                        icon={Trash2}
                        onClick={() => onDrain(queue.name)}
                      >
                        Drain
                      </Button>
                    </Tooltip>
                  </Flex>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}
