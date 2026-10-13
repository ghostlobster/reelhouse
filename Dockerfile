# Build the React client
FROM node:22-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Install server production dependencies (better-sqlite3 is a native module)
FROM node:22-bookworm-slim AS server-deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Runtime: the server runs straight from TypeScript via tsx and serves client/dist
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001
COPY --from=server-deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY server/ ./server/
COPY --from=client-build /app/client/dist ./client/dist
# data/ (SQLite) and downloads/ are created relative to the working directory
RUN mkdir -p data downloads && chown -R node:node /app
USER node
EXPOSE 3001
VOLUME ["/app/data", "/app/downloads"]
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/src/index.ts"]
