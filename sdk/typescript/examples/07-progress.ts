/**
 * Progress Tracking
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

// Worker with progress updates
const worker = new Worker('upload', async (job) => {
  const steps = ['Reading', 'Processing', 'Encoding', 'Uploading', 'Done'];
  for (let i = 0; i < steps.length; i++) {
    await client.progress(job.id, (i + 1) * 20, steps[i]);
    console.log(`Progress: ${(i + 1) * 20}% - ${steps[i]}`);
    await new Promise(r => setTimeout(r, 300));
  }
  return { uploaded: true };
}, { concurrency: 1 });

await worker.start();

// Push job
await client.push('upload', { file: 'video.mp4' });

// Wait for completion
await new Promise(r => setTimeout(r, 3000));

await worker.stop();
await client.close();
