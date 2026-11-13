FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --fetch-retries=4 --fetch-retry-mintimeout=1000
COPY tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
COPY tests ./tests
COPY deploy ./deploy
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/blobs /ops /backups /exchange && chown -R node:node /data /ops /backups /exchange
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","--import","tsx","apps/api/index.ts"]

FROM postgres:17-bookworm AS ops
COPY --from=runtime /usr/local/bin/node /usr/local/bin/node
WORKDIR /app
COPY --from=build /app /app
RUN useradd -u 1000 -m smarchat && mkdir -p /data /ops /backups && chown -R 1000:1000 /data /ops /backups
USER 1000:1000
ENV NODE_ENV=production
ENTRYPOINT ["node","--import","tsx"]
CMD ["deploy/ops.ts"]
