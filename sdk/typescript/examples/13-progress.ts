/**
 * Progress Tracking - Report job progress
 */
import { FlashQ, Worker } from '../src';

const client = new FlashQ();

// Worker that reports progress
const worker = new Worker('uploads', async (job) => {
  const steps = ['Reading', 'Processing', 'Encoding', 'Uploading', 'Done'];

  for (let i = 0; i < steps.length; i++) {
    const progress = (i + 1) * 20;
    await client.progress(job.id, progress, steps[i]);
    console.log(`Progress: ${progress}% - ${steps[i]}`);
    await new Promise(r => setTimeout(r, 300));
  }

  return { uploaded: true };
}, { autorun: false });
await worker.start();

// Add job
await client.add('uploads', { file: 'video.mp4' });

await new Promise(r => setTimeout(r, 3000));

await worker.close();
await client.close();
