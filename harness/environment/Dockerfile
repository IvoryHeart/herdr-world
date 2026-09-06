FROM rust:1.97.1-bookworm AS rust
FROM node:22.23.2-bookworm
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
ENV PATH="/opt/harness/bin:/opt/harness/node_modules/.bin:/usr/local/cargo/bin:${PATH}" \
    RUSTUP_HOME=/usr/local/rustup CARGO_HOME=/usr/local/cargo
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep libssl-dev pkg-config \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpango-1.0-0 libcairo2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
RUN rustup component add rustfmt \
    && cargo install cargo-about --version 0.9.2 --locked --features cli \
    && cargo install cargo-audit --version 0.22.2 --locked
COPY package.json package-lock.json install-ralph.mjs ralph-release.json /opt/harness/
RUN npm ci --prefix /opt/harness
RUN printf '%s\n' 'export PATH="/opt/harness/bin:/opt/harness/node_modules/.bin:/usr/local/cargo/bin:$PATH"' > /etc/profile.d/herdr-world-tools.sh
ENV CARGO_HOME=/workspace/.agents/cache/cargo
WORKDIR /workspace
USER node
RUN node --version && rustc --version && cargo fmt --version && cargo-about --version && cargo audit --version && ralph --version && codex --version \
    && bash -lc 'cargo --version && cargo about --version && ralph --version && codex --version'
