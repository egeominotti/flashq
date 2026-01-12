# FlashQ PHP SDK

High-performance job queue client for PHP.

## Installation

```bash
composer require flashq/flashq-php
```

## Quick Start

```php
<?php

use FlashQ\FlashQ;

$client = new FlashQ();
$client->connect();

// Push a job
$job = $client->push('emails', [
    'to' => 'user@example.com',
    'subject' => 'Hello!'
]);
echo "Created job {$job->id}\n";

// Get stats
$stats = $client->stats();
echo "Queued: {$stats->queued}\n";

$client->close();
```

## Features

### Push Jobs

```php
use FlashQ\FlashQ;
use FlashQ\PushOptions;

$client = new FlashQ();
$client->connect();

// Simple push
$job = $client->push('queue', ['data' => 'value']);

// With options
$job = $client->push('queue', ['data' => 'value'], new PushOptions(
    priority: 10,          // Higher = processed first
    delay: 5000,           // Delay in ms
    maxAttempts: 3,        // Retry attempts
    backoff: 1000,         // Backoff base (exponential)
    timeout: 30000,        // Processing timeout
    ttl: 3600000,          // Time-to-live
    uniqueKey: 'key123',   // Deduplication
    dependsOn: [1, 2],     // Job dependencies
    tags: ['important']    // Tags for filtering
));

// Batch push
$ids = $client->pushBatch('queue', [
    ['data' => ['task' => 1]],
    ['data' => ['task' => 2], 'priority' => 5],
]);
```

### Pull & Process Jobs

```php
// Pull single job (blocking)
$job = $client->pull('queue');

// Pull batch
$jobs = $client->pullBatch('queue', 10);

// Acknowledge completion
$client->ack($job->id, ['success' => true]);

// Acknowledge batch
$client->ackBatch(array_map(fn($j) => $j->id, $jobs));

// Fail job (will retry or go to DLQ)
$client->fail($job->id, 'Something went wrong');
```

### Job Progress

```php
// Update progress
$client->progress($jobId, 50, 'Halfway done');

// Get progress
$prog = $client->getProgress($jobId);
echo "Progress: {$prog->progress}% - {$prog->message}\n";
```

### Queue Control

```php
// Pause/Resume
$client->pause('queue');
$client->resume('queue');

// Rate limiting (jobs per second)
$client->setRateLimit('queue', 100);
$client->clearRateLimit('queue');

// Concurrency limiting
$client->setConcurrency('queue', 5);
$client->clearConcurrency('queue');

// List queues
$queues = $client->listQueues();
foreach ($queues as $q) {
    echo "{$q->name}: {$q->pending} pending\n";
}
```

### Dead Letter Queue

```php
// Get failed jobs
$failed = $client->getDlq('queue', 100);

// Retry all DLQ jobs
$count = $client->retryDlq('queue');

// Retry specific job
$client->retryDlq('queue', $jobId);
```

### Cron Jobs

```php
use FlashQ\CronOptions;

// Add cron job (runs every minute)
$client->addCron('cleanup', new CronOptions(
    queue: 'maintenance',
    data: ['task' => 'cleanup'],
    schedule: '0 * * * * *',  // sec min hour day month weekday
    priority: 5
));

// List cron jobs
$crons = $client->listCrons();

// Delete cron job
$client->deleteCron('cleanup');
```

### Metrics

```php
// Basic stats
$stats = $client->stats();
echo "Queued: {$stats->queued}\n";
echo "Processing: {$stats->processing}\n";
echo "Delayed: {$stats->delayed}\n";
echo "DLQ: {$stats->dlq}\n";

// Detailed metrics
$metrics = $client->metrics();
echo "Total pushed: {$metrics->totalPushed}\n";
echo "Jobs/sec: {$metrics->jobsPerSecond}\n";
echo "Avg latency: {$metrics->avgLatencyMs}ms\n";
```

## Connection Options

```php
use FlashQ\FlashQ;

// Default connection
$client = new FlashQ();

// Custom host/port
$client = new FlashQ(
    host: 'localhost',
    port: 6789,
    timeout: 5.0
);

// With authentication
$client = new FlashQ(
    host: 'localhost',
    port: 6789,
    token: 'secret'
);
```

## Worker Example

```php
<?php

use FlashQ\FlashQ;

$client = new FlashQ();
$client->connect();

echo "Worker started...\n";

while (true) {
    try {
        $job = $client->pull('emails');

        echo "Processing job {$job->id}\n";

        // Update progress
        $client->progress($job->id, 50, 'Sending email...');

        // Do work
        sendEmail($job->data);

        // Complete
        $client->ack($job->id, ['sent' => true]);

    } catch (Exception $e) {
        echo "Error: {$e->getMessage()}\n";
        if (isset($job)) {
            $client->fail($job->id, $e->getMessage());
        }
    }
}
```

## Running Tests

```bash
# Run all tests
php examples/test_all_apis.php

# With PHPUnit (requires composer install)
composer test
```

## License

MIT
