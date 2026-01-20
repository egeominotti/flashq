<div align="center">

# flashQ

**High-performance job queue. No Redis required.**

[![CI](https://img.shields.io/github/actions/workflow/status/egeominotti/flashq/ci.yml?branch=main&label=CI)](https://github.com/egeominotti/flashq/actions)
[![npm](https://img.shields.io/npm/v/flashq)](https://www.npmjs.com/package/flashq)
[![License](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

[Website](https://flashq.dev) • [Docs](https://flashq.dev/docs/) • [Blog](https://flashq.dev/blog/)

</div>

---

## Quick Start

```bash
# Start server
docker run -d -p 6789:6789 -p 6790:6790 -e HTTP=1 ghcr.io/egeominotti/flashq:latest

# Install SDK
npm install flashq  # or: bun add flashq
```

```typescript
import { Queue, Worker } from 'flashq';

const queue = new Queue('tasks');
await queue.add('job', { data: 'hello' });

const worker = new Worker('tasks', async (job) => {
  console.log(job.data);
});
```

## Links

- **Documentation**: [flashq.dev/docs](https://flashq.dev/docs/)
- **Examples**: [sdk/typescript/examples/](sdk/typescript/examples/)
- **Releases**: [GitHub Releases](https://github.com/egeominotti/flashq/releases)

## License

MIT
