<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Queue information
 */
class QueueInfo
{
    public function __construct(
        public readonly string $name,
        public readonly int $pending,
        public readonly int $processing,
        public readonly int $dlq,
        public readonly bool $paused = false,
        public readonly ?int $rateLimit = null,
        public readonly ?int $concurrencyLimit = null,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            name: $data['name'] ?? '',
            pending: $data['pending'] ?? 0,
            processing: $data['processing'] ?? 0,
            dlq: $data['dlq'] ?? 0,
            paused: $data['paused'] ?? false,
            rateLimit: $data['rate_limit'] ?? null,
            concurrencyLimit: $data['concurrency_limit'] ?? null,
        );
    }
}
