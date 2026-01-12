<?php
/**
 * FlashQ PHP SDK - Comprehensive API Test
 *
 * Tests all SDK functionality against a running FlashQ server.
 *
 * Usage:
 *     php examples/test_all_apis.php
 *
 * Requirements:
 *     - FlashQ server running on localhost:6789
 */

require_once __DIR__ . '/../src/FlashQ.php';
require_once __DIR__ . '/../src/FlashQException.php';
require_once __DIR__ . '/../src/Job.php';
require_once __DIR__ . '/../src/JobState.php';
require_once __DIR__ . '/../src/PushOptions.php';
require_once __DIR__ . '/../src/QueueStats.php';
require_once __DIR__ . '/../src/QueueInfo.php';
require_once __DIR__ . '/../src/Metrics.php';
require_once __DIR__ . '/../src/Progress.php';
require_once __DIR__ . '/../src/CronJob.php';
require_once __DIR__ . '/../src/CronOptions.php';

use FlashQ\FlashQ;
use FlashQ\PushOptions;
use FlashQ\CronOptions;
use FlashQ\JobState;
use FlashQ\FlashQException;

class TestRunner
{
    public int $passed = 0;
    public int $failed = 0;
    public array $errors = [];

    public function test(string $name, callable $fn): void
    {
        try {
            $fn();
            $this->passed++;
            echo "  ✓ {$name}\n";
        } catch (AssertionError $e) {
            $this->failed++;
            $this->errors[] = [$name, $e->getMessage()];
            echo "  ✗ {$name}: {$e->getMessage()}\n";
        } catch (Exception $e) {
            $this->failed++;
            $this->errors[] = [$name, get_class($e) . ': ' . $e->getMessage()];
            echo "  ✗ {$name}: " . get_class($e) . ": {$e->getMessage()}\n";
        }
    }

    public function summary(): bool
    {
        $total = $this->passed + $this->failed;
        echo "\n" . str_repeat("=", 60) . "\n";
        if ($this->failed === 0) {
            echo "  ✓ All {$total} tests passed!\n";
        } else {
            echo "  {$this->passed}/{$total} tests passed, {$this->failed} failed\n\n";
            echo "  Failed tests:\n";
            foreach ($this->errors as [$name, $error]) {
                echo "    - {$name}: {$error}\n";
            }
        }
        echo str_repeat("=", 60) . "\n";
        return $this->failed === 0;
    }
}

function assert_true(bool $condition, string $message = ''): void
{
    if (!$condition) {
        throw new AssertionError($message ?: 'Expected true');
    }
}

function assert_equals($expected, $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new AssertionError($message ?: "Expected {$expected}, got {$actual}");
    }
}

function assert_greater_than(int $expected, int $actual, string $message = ''): void
{
    if ($actual <= $expected) {
        throw new AssertionError($message ?: "Expected > {$expected}, got {$actual}");
    }
}

echo "FlashQ PHP SDK - API Tests\n";
echo str_repeat("=", 60) . "\n";

$runner = new TestRunner();

// ==================== TCP Tests ====================
echo "\n[TCP Protocol Tests]\n";

$client = new FlashQ();

// Connection
$runner->test('connect', function() use ($client) {
    $client->connect();
    assert_true($client->isConnected(), 'Client should be connected');
});

// Core Operations
$jobId = null;

$runner->test('push', function() use ($client, &$jobId) {
    $job = $client->push('test-queue', ['message' => 'hello']);
    $jobId = $job->id;
    assert_greater_than(0, $job->id, "Expected job ID > 0, got {$job->id}");
    assert_equals('test-queue', $job->queue);
});

$runner->test('push with options', function() use ($client) {
    $job = $client->push('test-queue', ['task' => 'process'], new PushOptions(
        priority: 10,
        maxAttempts: 3,
        tags: ['important']
    ));
    assert_equals(10, $job->priority);
});

$runner->test('push_batch', function() use ($client) {
    $ids = $client->pushBatch('batch-queue', [
        ['data' => ['n' => 1]],
        ['data' => ['n' => 2]],
        ['data' => ['n' => 3]],
    ]);
    assert_equals(3, count($ids), "Expected 3 IDs, got " . count($ids));
});

$runner->test('pull_batch', function() use ($client) {
    $jobs = $client->pullBatch('batch-queue', 3);
    assert_equals(3, count($jobs), "Expected 3 jobs, got " . count($jobs));
    // Cleanup
    $client->ackBatch(array_map(fn($j) => $j->id, $jobs));
});

$runner->test('ack_batch', function() use ($client) {
    $ids = $client->pushBatch('ack-batch-queue', [
        ['data' => ['n' => 1]],
        ['data' => ['n' => 2]],
    ]);
    $jobs = $client->pullBatch('ack-batch-queue', 2);
    $count = $client->ackBatch(array_map(fn($j) => $j->id, $jobs));
    assert_true($count >= 0);
});

$runner->test('pull and ack', function() use ($client) {
    $job = $client->push('pull-test', ['value' => 42]);
    $pulled = $client->pull('pull-test');
    assert_equals(42, $pulled->data['value']);
    $client->ack($pulled->id, ['processed' => true]);
});

$runner->test('fail', function() use ($client) {
    $job = $client->push('fail-test', ['will' => 'fail'], new PushOptions(maxAttempts: 2));
    $pulled = $client->pull('fail-test');
    $client->fail($pulled->id, 'Test failure');
});

$runner->test('progress', function() use ($client) {
    $job = $client->push('progress-test', ['task' => 'long']);
    $pulled = $client->pull('progress-test');
    $client->progress($pulled->id, 50, 'Halfway there');
    $prog = $client->getProgress($pulled->id);
    assert_equals(50, $prog->progress, "Expected 50, got {$prog->progress}");
    assert_equals('Halfway there', $prog->message);
    $client->ack($pulled->id);
});

$runner->test('cancel', function() use ($client) {
    $job = $client->push('cancel-test', ['will' => 'cancel']);
    $client->cancel($job->id);
});

$runner->test('get_state', function() use ($client) {
    $job = $client->push('state-test', ['data' => 1]);
    $state = $client->getState($job->id);
    assert_true(
        in_array($state, [JobState::WAITING, JobState::DELAYED]),
        "Unexpected state: " . ($state?->value ?? 'null')
    );
    // Cleanup
    $pulled = $client->pull('state-test');
    $client->ack($pulled->id);
});

$runner->test('get_result', function() use ($client) {
    $job = $client->push('result-test', ['data' => 1]);
    $pulled = $client->pull('result-test');
    $client->ack($pulled->id, ['answer' => 42]);
    $result = $client->getResult($pulled->id);
    assert_equals(42, $result['answer']);
});

// Queue Control
$runner->test('pause/resume', function() use ($client) {
    $client->pause('pause-test');
    $client->resume('pause-test');
});

$runner->test('rate_limit', function() use ($client) {
    $client->setRateLimit('rate-test', 100);
    $client->clearRateLimit('rate-test');
});

$runner->test('concurrency', function() use ($client) {
    $client->setConcurrency('conc-test', 5);
    $client->clearConcurrency('conc-test');
});

$runner->test('list_queues', function() use ($client) {
    $queues = $client->listQueues();
    assert_true(is_array($queues));
    assert_greater_than(0, count($queues));
});

// DLQ
$runner->test('dlq', function() use ($client) {
    $job = $client->push('dlq-test', ['fail' => true], new PushOptions(maxAttempts: 1));
    $pulled = $client->pull('dlq-test');
    $client->fail($pulled->id, 'Intentional failure');
    $dlqJobs = $client->getDlq('dlq-test');
    assert_true(is_array($dlqJobs));
});

$runner->test('retry_dlq', function() use ($client) {
    $count = $client->retryDlq('dlq-test');
    assert_true($count >= 0);
});

// Cron
$runner->test('add_cron', function() use ($client) {
    $client->addCron('test-cron', new CronOptions(
        queue: 'cron-queue',
        data: ['scheduled' => true],
        schedule: '0 0 * * * *',
        priority: 5
    ));
});

$runner->test('list_crons', function() use ($client) {
    $crons = $client->listCrons();
    assert_true(is_array($crons));
    $found = false;
    foreach ($crons as $cron) {
        if ($cron->name === 'test-cron') {
            $found = true;
            break;
        }
    }
    assert_true($found, 'test-cron not found in cron list');
});

$runner->test('delete_cron', function() use ($client) {
    $result = $client->deleteCron('test-cron');
    assert_true($result === true);
});

// Stats & Metrics
$runner->test('stats', function() use ($client) {
    $stats = $client->stats();
    assert_true($stats->queued >= 0);
    assert_true($stats->processing >= 0);
    assert_true($stats->delayed >= 0);
    assert_true($stats->dlq >= 0);
});

$runner->test('metrics', function() use ($client) {
    $metrics = $client->metrics();
    assert_true($metrics->totalPushed >= 0);
    assert_true($metrics->totalCompleted >= 0);
    assert_true($metrics->jobsPerSecond >= 0);
});

// Job Dependencies
$runner->test('dependencies', function() use ($client) {
    $parent = $client->push('deps-queue', ['type' => 'parent']);
    $child = $client->push('deps-queue', ['type' => 'child'], new PushOptions(
        dependsOn: [$parent->id]
    ));
    $state = $client->getState($child->id);
    assert_true(
        in_array($state, [JobState::WAITING, JobState::WAITING_CHILDREN]),
        "Unexpected state"
    );
    // Cleanup
    $pulled = $client->pull('deps-queue');
    $client->ack($pulled->id);
});

// Unique Jobs
$runner->test('unique_key deduplication', function() use ($client) {
    $key = 'unique-' . time();
    $job1 = $client->push('unique-queue', ['n' => 1], new PushOptions(uniqueKey: $key));
    try {
        $job2 = $client->push('unique-queue', ['n' => 2], new PushOptions(uniqueKey: $key));
        assert_equals($job1->id, $job2->id, "Expected deduplication: {$job1->id} != {$job2->id}");
    } catch (FlashQException $e) {
        assert_true(str_contains($e->getMessage(), 'Duplicate'), "Unexpected error: {$e->getMessage()}");
    }
    // Cleanup
    $pulled = $client->pull('unique-queue');
    $client->ack($pulled->id);
});

// Close connection
$client->close();

// Summary
$success = $runner->summary();
exit($success ? 0 : 1);
