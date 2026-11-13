FROM smarchat-server:1.0.0-alpha.3
USER root
COPY deploy/migration/package*.json /import-deps/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts --prefix /import-deps && node -e "const Database=require('/import-deps/node_modules/better-sqlite3-multiple-ciphers'); const d=new Database(':memory:'); d.exec('SELECT 1'); d.close()"
COPY packages/domain/legacy-backup.ts /app/packages/domain/legacy-backup.ts
COPY deploy/import-legacy.ts /app/deploy/import-legacy.ts
USER node
ENTRYPOINT ["node","--import","tsx","deploy/import-legacy.ts"]
