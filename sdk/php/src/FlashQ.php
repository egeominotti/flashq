<?php

declare(strict_types=1);

namespace FlashQ;

/**
 * FlashQ Client
 *
 * High-performance job queue client for PHP.
 *
 * Example:
 *     $client = new FlashQ();
 *     $client->connect();
 *     $job = $client->push('emails', ['to' => 'user@example.com']);
 *     $client->close();
 */
class FlashQ
{
    /** @var resource|null */
    private $socket = null;
    private bool $connected = false;

    public function __construct(
        private readonly string $host = 'localhost',
        private readonly int $port = 6789,
        private readonly ?string $token = null,
        private readonly float $timeout = 5.0,
    ) {}

    /**
     * Connect to FlashQ server
     */
    public function connect(): void
    {
        if ($this->connected) {
            return;
        }

        $this->socket = @stream_socket_client(
            "tcp://{$this->host}:{$this->port}",
            $errno,
            $errstr,
            $this->timeout
        );

        if ($this->socket === false) {
            throw new ConnectionException("Failed to connect: $errstr ($errno)");
        }

        stream_set_timeout($this->socket, (int)$this->timeout, (int)(($this->timeout - (int)$this->timeout) * 1000000));
        $this->connected = true;

        if ($this->token !== null) {
            $this->auth($this->token);
        }
    }

    /**
     * Close the connection
     */
    public function close(): void
    {
        if ($this->socket !== null) {
            fclose($this->socket);
            $this->socket = null;
        }
        $this->connected = false;
    }

    /**
     * Check if connected
     */
    public function isConnected(): bool
    {
        return $this->connected;
    }

    /**
     * Authenticate with the server
     */
    public function auth(string $token): void
    {
        $response = $this->send(['cmd' => 'AUTH', 'token' => $token]);
        if (!($response['ok'] ?? false)) {
            throw new AuthenticationException('Authentication failed');
        }
    }

    // ============== Core Operations ==============

    /**
     * Push a job to a queue
     */
    public function push(string $queue, mixed $data, ?PushOptions $options = null): Job
    {
        $opts = $options ?? new PushOptions();

        $response = $this->send(array_merge([
            'cmd' => 'PUSH',
            'queue' => $queue,
            'data' => $data,
        ], $opts->toArray()));

        return new Job(
            id: $response['id'],
            queue: $queue,
            data: $data,
            priority: $opts->priority,
        );
    }

    /**
     * Push multiple jobs to a queue
     *
     * @return int[] Job IDs
     */
    public function pushBatch(string $queue, array $jobs): array
    {
        $response = $this->send([
            'cmd' => 'PUSHB',
            'queue' => $queue,
            'jobs' => array_map(fn($j) => [
                'data' => $j['data'] ?? $j,
                'priority' => $j['priority'] ?? 0,
                'delay' => $j['delay'] ?? null,
                'ttl' => $j['ttl'] ?? null,
                'timeout' => $j['timeout'] ?? null,
                'max_attempts' => $j['max_attempts'] ?? null,
                'backoff' => $j['backoff'] ?? null,
                'unique_key' => $j['unique_key'] ?? null,
                'depends_on' => $j['depends_on'] ?? null,
                'tags' => $j['tags'] ?? null,
            ], $jobs),
        ]);

        return $response['ids'] ?? [];
    }

    /**
     * Pull a job from a queue (blocking)
     */
    public function pull(string $queue): Job
    {
        $response = $this->send(['cmd' => 'PULL', 'queue' => $queue]);
        return Job::fromArray($response['job'] ?? []);
    }

    /**
     * Pull multiple jobs from a queue
     *
     * @return Job[]
     */
    public function pullBatch(string $queue, int $count): array
    {
        $response = $this->send(['cmd' => 'PULLB', 'queue' => $queue, 'count' => $count]);
        return array_map(fn($j) => Job::fromArray($j), $response['jobs'] ?? []);
    }

    /**
     * Acknowledge a job as completed
     */
    public function ack(int $jobId, mixed $result = null): void
    {
        $this->send(['cmd' => 'ACK', 'id' => $jobId, 'result' => $result]);
    }

    /**
     * Acknowledge multiple jobs
     */
    public function ackBatch(array $jobIds): int
    {
        $response = $this->send(['cmd' => 'ACKB', 'ids' => $jobIds]);
        $ids = $response['ids'] ?? [];
        return $ids[0] ?? 0;
    }

    /**
     * Fail a job (will retry or move to DLQ)
     */
    public function fail(int $jobId, ?string $error = null): void
    {
        $this->send(['cmd' => 'FAIL', 'id' => $jobId, 'error' => $error]);
    }

    // ============== Job Management ==============

    /**
     * Get job state
     */
    public function getState(int $jobId): ?JobState
    {
        $response = $this->send(['cmd' => 'GETSTATE', 'id' => $jobId]);
        $state = $response['state'] ?? null;
        return $state !== null ? JobState::fromString($state) : null;
    }

    /**
     * Get job result
     */
    public function getResult(int $jobId): mixed
    {
        $response = $this->send(['cmd' => 'GETRESULT', 'id' => $jobId]);
        return $response['result'] ?? null;
    }

    /**
     * Cancel a pending job
     */
    public function cancel(int $jobId): void
    {
        $this->send(['cmd' => 'CANCEL', 'id' => $jobId]);
    }

    /**
     * Update job progress
     */
    public function progress(int $jobId, int $progress, ?string $message = null): void
    {
        $this->send([
            'cmd' => 'PROGRESS',
            'id' => $jobId,
            'progress' => max(0, min(100, $progress)),
            'message' => $message,
        ]);
    }

    /**
     * Get job progress
     */
    public function getProgress(int $jobId): Progress
    {
        $response = $this->send(['cmd' => 'GETPROGRESS', 'id' => $jobId]);
        return Progress::fromArray($response);
    }

    // ============== Dead Letter Queue ==============

    /**
     * Get jobs from the dead letter queue
     *
     * @return Job[]
     */
    public function getDlq(string $queue, int $count = 100): array
    {
        $response = $this->send(['cmd' => 'DLQ', 'queue' => $queue, 'count' => $count]);
        return array_map(fn($j) => Job::fromArray($j), $response['jobs'] ?? []);
    }

    /**
     * Retry jobs from DLQ
     */
    public function retryDlq(string $queue, ?int $jobId = null): int
    {
        $response = $this->send(['cmd' => 'RETRYDLQ', 'queue' => $queue, 'id' => $jobId]);
        $ids = $response['ids'] ?? [];
        return $ids[0] ?? 0;
    }

    // ============== Queue Control ==============

    /**
     * Pause a queue
     */
    public function pause(string $queue): void
    {
        $this->send(['cmd' => 'PAUSE', 'queue' => $queue]);
    }

    /**
     * Resume a paused queue
     */
    public function resume(string $queue): void
    {
        $this->send(['cmd' => 'RESUME', 'queue' => $queue]);
    }

    /**
     * Set rate limit for a queue
     */
    public function setRateLimit(string $queue, int $limit): void
    {
        $this->send(['cmd' => 'RATELIMIT', 'queue' => $queue, 'limit' => $limit]);
    }

    /**
     * Clear rate limit for a queue
     */
    public function clearRateLimit(string $queue): void
    {
        $this->send(['cmd' => 'RATELIMITCLEAR', 'queue' => $queue]);
    }

    /**
     * Set concurrency limit for a queue
     */
    public function setConcurrency(string $queue, int $limit): void
    {
        $this->send(['cmd' => 'SETCONCURRENCY', 'queue' => $queue, 'limit' => $limit]);
    }

    /**
     * Clear concurrency limit for a queue
     */
    public function clearConcurrency(string $queue): void
    {
        $this->send(['cmd' => 'CLEARCONCURRENCY', 'queue' => $queue]);
    }

    /**
     * List all queues
     *
     * @return QueueInfo[]
     */
    public function listQueues(): array
    {
        $response = $this->send(['cmd' => 'LISTQUEUES']);
        return array_map(fn($q) => QueueInfo::fromArray($q), $response['queues'] ?? []);
    }

    // ============== Cron Jobs ==============

    /**
     * Add a cron job
     */
    public function addCron(string $name, CronOptions $options): void
    {
        $this->send([
            'cmd' => 'CRON',
            'name' => $name,
            'queue' => $options->queue,
            'data' => $options->data,
            'schedule' => $options->schedule,
            'priority' => $options->priority,
        ]);
    }

    /**
     * Delete a cron job
     */
    public function deleteCron(string $name): bool
    {
        $response = $this->send(['cmd' => 'CRONDELETE', 'name' => $name]);
        return $response['ok'] ?? false;
    }

    /**
     * List all cron jobs
     *
     * @return CronJob[]
     */
    public function listCrons(): array
    {
        $response = $this->send(['cmd' => 'CRONLIST']);
        return array_map(fn($c) => CronJob::fromArray($c), $response['crons'] ?? []);
    }

    // ============== Stats & Metrics ==============

    /**
     * Get queue statistics
     */
    public function stats(): QueueStats
    {
        $response = $this->send(['cmd' => 'STATS']);
        return QueueStats::fromArray($response);
    }

    /**
     * Get detailed metrics
     */
    public function metrics(): Metrics
    {
        $response = $this->send(['cmd' => 'METRICS']);
        return Metrics::fromArray($response);
    }

    // ============== Internal Methods ==============

    /**
     * Send command and receive response
     */
    private function send(array $command): array
    {
        if (!$this->connected) {
            $this->connect();
        }

        if ($this->socket === null) {
            throw new ConnectionException('Not connected');
        }

        // Send command
        $data = json_encode($command) . "\n";
        $written = fwrite($this->socket, $data);

        if ($written === false) {
            throw new ConnectionException('Failed to send command');
        }

        // Read response
        $response = fgets($this->socket);

        if ($response === false) {
            $meta = stream_get_meta_data($this->socket);
            if ($meta['timed_out']) {
                throw new TimeoutException('Request timeout');
            }
            throw new ConnectionException('Connection closed');
        }

        $decoded = json_decode($response, true);

        if ($decoded === null) {
            throw new FlashQException('Invalid response: ' . json_last_error_msg());
        }

        if (($decoded['ok'] ?? true) === false) {
            throw new FlashQException($decoded['error'] ?? 'Unknown error');
        }

        return $decoded;
    }

    /**
     * Destructor - close connection
     */
    public function __destruct()
    {
        $this->close();
    }
}
