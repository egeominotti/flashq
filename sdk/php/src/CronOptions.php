<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Options for creating a cron job
 */
class CronOptions
{
    public function __construct(
        public readonly string $queue,
        public readonly mixed $data,
        public readonly string $schedule,
        public readonly int $priority = 0,
    ) {}
}
