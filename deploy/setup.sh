#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p .secrets
for name in db_password api_password worker_password master_key; do
  if [ ! -f ".secrets/$name" ]; then openssl rand -hex 32 > ".secrets/$name"; fi
done
for name in bootstrap_password team_Bison02 team_Bison03 team_Bison04 team_Bison05 team_Bison06 team_Bison07; do
  if [ ! -f ".secrets/$name" ]; then printf '%s\n' 'bison666' > ".secrets/$name"; fi
done
chmod 700 .secrets
chmod 600 .secrets/*
printf '%s\n' 'Deployment secrets are ready. Initial username: Bison01' 'Initial password: .secrets/bootstrap_password (shown only when you open the file).' 'Run: docker compose up -d --build' 'Open: http://localhost:6081'
