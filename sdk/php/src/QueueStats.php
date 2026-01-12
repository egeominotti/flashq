<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Queue statistics
 */
class QueueStats
{
    public function __construct(
        public readonly int $queued,
        public readonly int $processing,
        public readonly int $delayed,
        public readonly int $dlq,
    ) {}

    public static function fromArray(array $data): self
    {
        return new self(
            queued: $data['queued'] ?? 0,
            processing: $data['processing'] ?? 0,
            delayed: $data['delayed'] ?? 0,
            dlq: $data['dlq'] ?? 0,
        );
    }
}
