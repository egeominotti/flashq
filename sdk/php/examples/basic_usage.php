<?php
/**
 * FlashQ PHP SDK - Basic Usage Example
 *
 * Usage:
 *     php examples/basic_usage.php
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

echo "FlashQ PHP SDK - Basic Usage Example\n";
echo str_repeat("=", 40) . "\n";

$client = new FlashQ();
$client->connect();

try {
    // Push a job
    $job = $client->push('emails', [
        'to' => 'user@example.com',
        'subject' => 'Welcome!',
        'body' => 'Hello from FlashQ!'
    ]);
    echo "Created job {$job->id}\n";

    // Get stats
    $stats = $client->stats();
    echo "Queue stats - Queued: {$stats->queued}, Processing: {$stats->processing}\n";

    // Push with options
    $job2 = $client->push('notifications', ['message' => 'Hello!'], new PushOptions(
        priority: 10,
        maxAttempts: 3
    ));
    echo "Created notification job {$job2->id}\n";

    // Pull and process the job
    $pulled = $client->pull('notifications');
    echo "Pulled job {$pulled->id}: " . json_encode($pulled->data) . "\n";

    // Acknowledge completion
    $client->ack($pulled->id, ['sent' => true]);
    echo "Job {$pulled->id} completed\n";

    // Pull and ack the email job
    $emailJob = $client->pull('emails');
    $client->ack($emailJob->id);
    echo "Email job completed\n";

} finally {
    $client->close();
}

echo "\nBasic usage complete!\n";
