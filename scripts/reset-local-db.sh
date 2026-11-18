#!/usr/bin/env bash
# Local development only: drop and recreate the local Postgres database. Never point at Supabase.
set -euo pipefail
DB="${1:-caps}"
su postgres -c "psql -q -c 'drop database if exists $DB with (force);' -c 'create database $DB owner caps;'"
