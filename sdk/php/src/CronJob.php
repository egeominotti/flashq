<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Cron job definition
 */
class CronJob
{
    public function __construct(
        public readonly string $name,
        public readonly string $queue,
        public readonly mixed $data,
        public readonly string $schedule,
        public readonly int $priority,
        public readonly int $nextRun,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            name: $data['name'] ?? '',
            queue: $data['queue'] ?? '',
            data: $data['data'] ?? null,
            schedule: $data['schedule'] ?? '',
            priority: $data['priority'] ?? 0,
            nextRun: $data['next_run'] ?? 0,
        );
    }
}
