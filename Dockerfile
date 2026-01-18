# Stage 1: Build
FROM rust:latest AS builder

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

# Build release binary with LTO and io_uring support (Linux)
RUN cargo build --release --features io-uring

# Stage 2: Runtime (minimal, matches builder's glibc)
FROM debian:trixie-slim

# Install CA certificates for HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

# Copy binary
COPY --from=builder /app/target/release/flashq-server /flashq-server

# Expose ports
EXPOSE 6789 6790 6791

# Set environment
ENV RUST_LOG=info
ENV ENV=dev
ENV RATE_LIMIT_REQUESTS=0

# Entrypoint
ENTRYPOINT ["/flashq-server"]
