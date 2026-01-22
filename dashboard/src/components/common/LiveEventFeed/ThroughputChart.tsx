import { memo } from 'react';

interface ThroughputChartProps {
  data: number[];
  maxValue: number;
}

export const ThroughputChart = memo(function ThroughputChart({ data, maxValue }: ThroughputChartProps) {
  const max = Math.max(maxValue, Math.max(...data), 1);

  const createPath = (values: number[], height: number) => {
    const width = 100;
    const points = values.map((v, i) => ({
      x: (i / (values.length - 1)) * width,
      y: height - (v / max) * height,
    }));

    if (points.length < 2) return '';

    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpx = (prev.x + curr.x) / 2;
      path += ` Q ${prev.x + (curr.x - prev.x) / 4} ${prev.y}, ${cpx} ${(prev.y + curr.y) / 2}`;
      path += ` Q ${curr.x - (curr.x - prev.x) / 4} ${curr.y}, ${curr.x} ${curr.y}`;
    }

    return path;
  };

  const linePath = createPath(data, 100);
  const areaPath = linePath + ` L 100 100 L 0 100 Z`;

  return (
    <svg className="throughput-chart" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#00d4ff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#00d4ff" stopOpacity="1" />
        </linearGradient>
      </defs>
      <line x1="0" y1="25" x2="100" y2="25" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      <line x1="0" y1="75" x2="100" y2="75" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
      <path d={areaPath} fill="url(#areaGradient)" />
      <path
        d={linePath}
        fill="none"
        stroke="url(#lineGradient)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {data.length > 0 && (
        <circle
          cx="100"
          cy={100 - (data[data.length - 1] / max) * 100}
          r="3"
          fill="#00d4ff"
          className="pulse-dot"
        />
      )}
    </svg>
  );
});
