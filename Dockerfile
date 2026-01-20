# Stage 1: Build
FROM rust:1.92-bookworm AS builder

ARG TARGETARCH

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    protobuf-compiler \
    libprotobuf-dev \
    build-essential \
    lld \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Verify protoc version
RUN protoc --version

# Copy source
COPY engine/ ./

# Remove .cargo/config.toml to avoid target-cpu=native conflicts
RUN rm -f .cargo/config.toml

# Build with architecture-specific RUSTFLAGS
# gxhash requires AES intrinsics: x86_64 needs +aes, ARM64 needs +aes,+neon
# x86-64-v2: SSE4.2 baseline (compatible with most servers from 2010+)
# ARM64 generic: Baseline ARMv8-A with mandatory NEON
RUN case "${TARGETARCH}" in \
    "amd64") \
    RUSTFLAGS="-C target-cpu=x86-64-v2 -C target-feature=+aes,+sse4.2" \
    cargo build --release --features io-uring ;; \
    "arm64") \
    RUSTFLAGS="-C target-cpu=generic -C target-feature=+aes,+neon" \
    cargo build --release --features io-uring ;; \
    *) \
    echo "Unsupported architecture: ${TARGETARCH}" && exit 1 ;; \
    esac

# Stage 2: Runtime (minimal, matches builder's glibc)
FROM debian:bookworm-slim

# Install CA certificates for HTTPS and runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy binary
COPY --from=builder /app/target/release/flashq-server /flashq-server

# Expose ports
EXPOSE 6789 6790 6791

# Set environment
ENV RUST_LOG=info
ENV ENV=dev
ENV RATE_LIMIT_REQUESTS=0

# Health check via HTTP endpoint (requires HTTP=1)
# Disabled by default since HTTP is optional
# HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
#     CMD curl -f http://localhost:6790/health || exit 1

# Entrypoint
ENTRYPOINT ["/flashq-server"]
