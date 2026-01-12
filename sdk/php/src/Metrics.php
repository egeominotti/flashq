<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Global metrics
 */
class Metrics
{
    public function __construct(
        public readonly int $totalPushed,
        public readonly int $totalCompleted,
        public readonly int $totalFailed,
        public readonly float $jobsPerSecond,
        public readonly float $avgLatencyMs,
        public readonly array $queues = [],
    ) {}

    public static function fromArray(array $data): self
    {
        $m = $data['metrics'] ?? $data;
        return new self(
            totalPushed: $m['total_pushed'] ?? 0,
            totalCompleted: $m['total_completed'] ?? 0,
            totalFailed: $m['total_failed'] ?? 0,
            jobsPerSecond: $m['jobs_per_second'] ?? 0.0,
            avgLatencyMs: $m['avg_latency_ms'] ?? 0.0,
            queues: $m['queues'] ?? [],
        );
    }
}
