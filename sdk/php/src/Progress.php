<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * Job progress information
 */
class Progress
{
    public function __construct(
        public readonly int $progress,
        public readonly ?string $message = null,
    ) {}

    public static function fromArray(array $data): self
    {
        $p = $data['progress'] ?? $data;
        return new self(
            progress: $p['progress'] ?? 0,
            message: $p['message'] ?? null,
        );
    }
}
