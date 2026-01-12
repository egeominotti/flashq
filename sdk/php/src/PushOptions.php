<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Options for pushing a job
 */
class PushOptions
{
    public function __construct(
        public readonly int $priority = 0,
        public readonly ?int $delay = null,
        public readonly ?int $ttl = null,
        public readonly ?int $timeout = null,
        public readonly ?int $maxAttempts = null,
        public readonly ?int $backoff = null,
        public readonly ?string $uniqueKey = null,
        public readonly ?array $dependsOn = null,
        public readonly ?array $tags = null,
    ) {}

    /**
     * Convert to array for sending
     */
    public function toArray(): array
    {
        return array_filter([
            'priority' => $this->priority,
            'delay' => $this->delay,
            'ttl' => $this->ttl,
            'timeout' => $this->timeout,
            'max_attempts' => $this->maxAttempts,
            'backoff' => $this->backoff,
            'unique_key' => $this->uniqueKey,
            'depends_on' => $this->dependsOn,
            'tags' => $this->tags,
        ], fn($v) => $v !== null);
    }
}
