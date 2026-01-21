# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Build args for environment variables
ARG VITE_FLASHQ_API_URL=http://localhost:6790
ARG VITE_FLASHQ_AUTH_TOKEN=

ENV VITE_FLASHQ_API_URL=$VITE_FLASHQ_API_URL
ENV VITE_FLASHQ_AUTH_TOKEN=$VITE_FLASHQ_AUTH_TOKEN

# Build the app
RUN bun run build

# Production stage - Caddy
FROM caddy:2-alpine

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

# Copy built assets
COPY --from=builder /app/dist /srv

# Expose port
EXPOSE 80

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile"]
