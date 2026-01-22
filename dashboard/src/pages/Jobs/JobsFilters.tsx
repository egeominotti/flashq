import { Flex, Select, SelectItem, TextInput } from '@tremor/react';
import { Search, Filter, X } from 'lucide-react';
import type { Queue } from '../../api/types';

type JobState = 'all' | 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

interface JobsFiltersProps {
  queues: Queue[];
  selectedQueue: string;
  selectedState: JobState;
  searchTerm: string;
  onQueueChange: (queue: string) => void;
  onStateChange: (state: JobState) => void;
  onSearchChange: (term: string) => void;
}

export function JobsFilters({
  queues,
  selectedQueue,
  selectedState,
  searchTerm,
  onQueueChange,
  onStateChange,
  onSearchChange,
}: JobsFiltersProps) {
  return (
    <>
      <div className="filters-header">
        <div className="filters-title">
          <Filter className="h-4 w-4" />
          <span>Filters</span>
        </div>
        {selectedState !== 'all' && (
          <button className="clear-filter" onClick={() => onStateChange('all')}>
            Clear filter
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <Flex className="mb-6 flex-wrap gap-4">
        <Select
          value={selectedQueue}
          onValueChange={onQueueChange}
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
          onValueChange={(v) => onStateChange(v as JobState)}
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
          onChange={(e) => onSearchChange(e.target.value)}
          className="max-w-xs"
        />
      </Flex>
    </>
  );
}
