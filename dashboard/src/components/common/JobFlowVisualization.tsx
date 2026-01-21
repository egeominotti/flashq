import { ArrowRight, Clock, Loader2, CheckCircle2, XCircle, Calendar, Play } from 'lucide-react';
import { cn, formatNumber } from '../../utils';
import './JobFlowVisualization.css';

interface FlowNodeData {
  waiting: number;
  delayed: number;
  active: number;
  completed: number;
  failed: number;
}

interface JobFlowVisualizationProps {
  data: FlowNodeData;
  selectedState: string;
  onStateSelect: (state: string) => void;
}

interface FlowNodeProps {
  id: string;
  label: string;
  count: number;
  icon: React.ReactNode;
  color: 'cyan' | 'amber' | 'blue' | 'emerald' | 'rose';
  isSelected: boolean;
  onClick: () => void;
  pulse?: boolean;
}

function FlowNode({ label, count, icon, color, isSelected, onClick, pulse }: FlowNodeProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flow-node',
        `flow-node-${color}`,
        isSelected && 'flow-node-selected',
        pulse && count > 0 && 'flow-node-pulse'
      )}
    >
      <div className="flow-node-glow" />
      <div className="flow-node-content">
        <div className={cn('flow-node-icon', `icon-${color}`)}>{icon}</div>
        <div className="flow-node-info">
          <span className="flow-node-count">{formatNumber(count)}</span>
          <span className="flow-node-label">{label}</span>
        </div>
      </div>
    </button>
  );
}

function FlowArrow({ animated = false }: { animated?: boolean }) {
  return (
    <div className={cn('flow-arrow', animated && 'flow-arrow-animated')}>
      <div className="flow-arrow-line" />
      <ArrowRight className="flow-arrow-icon" />
    </div>
  );
}

export function JobFlowVisualization({
  data,
  selectedState,
  onStateSelect,
}: JobFlowVisualizationProps) {
  const hasActiveJobs = data.active > 0;

  return (
    <div className="job-flow-container">
      <div className="job-flow-header">
        <div className="flow-title">
          <Play className="h-4 w-4" />
          <span>Job Pipeline</span>
        </div>
        <div className="flow-legend">
          <span className="legend-item">
            <span className="legend-dot legend-dot-active" />
            Click to filter
          </span>
        </div>
      </div>

      <div className="job-flow">
        {/* Entry Point Group */}
        <div className="flow-group flow-group-entry">
          <div className="flow-group-label">Queued</div>
          <div className="flow-group-nodes">
            <FlowNode
              id="waiting"
              label="Waiting"
              count={data.waiting}
              icon={<Clock className="h-5 w-5" />}
              color="cyan"
              isSelected={selectedState === 'waiting'}
              onClick={() => onStateSelect('waiting')}
            />
            <FlowNode
              id="delayed"
              label="Delayed"
              count={data.delayed}
              icon={<Calendar className="h-5 w-5" />}
              color="amber"
              isSelected={selectedState === 'delayed'}
              onClick={() => onStateSelect('delayed')}
            />
          </div>
        </div>

        <FlowArrow animated={hasActiveJobs} />

        {/* Processing */}
        <div className="flow-group flow-group-processing">
          <div className="flow-group-label">Processing</div>
          <FlowNode
            id="active"
            label="Active"
            count={data.active}
            icon={<Loader2 className={cn('h-5 w-5', hasActiveJobs && 'animate-spin')} />}
            color="blue"
            isSelected={selectedState === 'active'}
            onClick={() => onStateSelect('active')}
            pulse
          />
        </div>

        <FlowArrow animated={hasActiveJobs} />

        {/* Exit Point Group */}
        <div className="flow-group flow-group-exit">
          <div className="flow-group-label">Completed</div>
          <div className="flow-group-nodes">
            <FlowNode
              id="completed"
              label="Success"
              count={data.completed}
              icon={<CheckCircle2 className="h-5 w-5" />}
              color="emerald"
              isSelected={selectedState === 'completed'}
              onClick={() => onStateSelect('completed')}
            />
            <FlowNode
              id="failed"
              label="Failed"
              count={data.failed}
              icon={<XCircle className="h-5 w-5" />}
              color="rose"
              isSelected={selectedState === 'failed'}
              onClick={() => onStateSelect('failed')}
            />
          </div>
        </div>
      </div>

      {/* Flow Stats */}
      <div className="flow-stats">
        <div className="flow-stat">
          <span className="flow-stat-value">{formatNumber(data.waiting + data.delayed)}</span>
          <span className="flow-stat-label">In Queue</span>
        </div>
        <div className="flow-stat">
          <span className="flow-stat-value">{formatNumber(data.active)}</span>
          <span className="flow-stat-label">Processing</span>
        </div>
        <div className="flow-stat">
          <span className="flow-stat-value">
            {data.completed + data.failed > 0
              ? ((data.completed / (data.completed + data.failed)) * 100).toFixed(1)
              : '0'}
            %
          </span>
          <span className="flow-stat-label">Success Rate</span>
        </div>
      </div>
    </div>
  );
}
