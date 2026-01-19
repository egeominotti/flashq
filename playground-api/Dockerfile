FROM oven/bun:1-alpine

WORKDIR /app

# Copy package.json
COPY playground-api/package.json playground-api/bun.lock* ./

# Install dependencies (uses npm flashq package)
RUN bun install --production

# Copy source
COPY playground-api/src ./src

# Expose port
EXPOSE 3000

# Environment variables
ENV FLASHQ_HOST=flashq
ENV FLASHQ_PORT=6789
ENV API_PORT=3000

# Start server
CMD ["bun", "run", "src/index.ts"]
