<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Represents a job in the queue
 */
class Job
{
    public function __construct(
        public readonly int $id,
        public readonly string $queue,
        public readonly mixed $data,
        public readonly int $priority = 0,
        public readonly int $createdAt = 0,
        public readonly int $runAt = 0,
        public readonly int $startedAt = 0,
        public readonly int $attempts = 0,
        public readonly int $maxAttempts = 0,
        public readonly int $backoff = 0,
        public readonly int $ttl = 0,
        public readonly int $timeout = 0,
        public readonly ?string $uniqueKey = null,
        public readonly array $dependsOn = [],
        public readonly int $progress = 0,
        public readonly ?string $progressMsg = null,
        public readonly array $tags = [],
    ) {}

    /**
     * Create Job from array data
     */
    public static function fromArray(array $data): self
    {
        return new self(
            id: $data['id'] ?? 0,
            queue: $data['queue'] ?? '',
            data: $data['data'] ?? null,
            priority: $data['priority'] ?? 0,
            createdAt: $data['created_at'] ?? 0,
            runAt: $data['run_at'] ?? 0,
            startedAt: $data['started_at'] ?? 0,
            attempts: $data['attempts'] ?? 0,
            maxAttempts: $data['max_attempts'] ?? 0,
            backoff: $data['backoff'] ?? 0,
            ttl: $data['ttl'] ?? 0,
            timeout: $data['timeout'] ?? 0,
            uniqueKey: $data['unique_key'] ?? null,
            dependsOn: $data['depends_on'] ?? [],
            progress: $data['progress'] ?? 0,
            progressMsg: $data['progress_msg'] ?? null,
            tags: $data['tags'] ?? [],
        );
    }
}
