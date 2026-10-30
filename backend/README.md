# RushHour Backend

This backend powers the RushHour game services, including game flow, wallet and payout-related operations, and the newer security, fairness, and monitoring capabilities.

## Requirements

- Python 3.12+
- Virtual environment (recommended)

## Setup

1. Navigate to the backend folder:
   ```bash
   cd /root/projects/RushHour/backend
   ```

2. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. If the project uses local editable dependencies or extras, install them as needed from the project configuration.

## Running the app

Start the FastAPI application with:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The app will be available at:
- http://localhost:8000/docs for Swagger UI
- http://localhost:8000/health for health checks
- http://localhost:8000/ready for readiness checks

## Running tests

Run the backend test suite with:

```bash
./.venv/bin/python -m pytest -q
```

For the most relevant regression checks for security, fairness, and monitoring:

```bash
./.venv/bin/python -m pytest -q tests/test_wallet.py tests/test_replay.py tests/test_video.py app/domains/security/tests/test_security.py app/domains/fairness/tests/test_fairness.py app/domains/monitoring/tests/test_monitoring.py
```

## Supabase / PostgreSQL support

This backend supports Supabase PostgreSQL through `DATABASE_URL`.

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `DATABASE_URL` to your Supabase connection string, for example:
   ```bash
   DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>:<port>/<database>
   ```
3. Install dependencies and the PostgreSQL async driver:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
4. Apply the managed schema from `backend/database/schema.sql` to your Supabase database.

The existing backend architecture and API contracts remain unchanged. The `backend/app/database/session.py` file already reads `DATABASE_URL`, so switching to PostgreSQL is a configuration-only change.

## Configuration settings

Add any of these override values to `backend/.env`:

```bash
BETTING_DURATION_SECONDS=15
REPLAY_DURATION_SECONDS=15
RESULT_DURATION_SECONDS=15
ONCHAIN_INTERACTION_ENABLED=false
```

`ONCHAIN_INTERACTION_ENABLED` controls backend round interaction with the ElyRush contract. Set it to `false` to create, open, lock, settle, and finish rounds using local backend state only; the backend will not initialize an RPC contract client. Set it to `true` to enable on-chain round creation and result submission (and transaction verification). When unset, it falls back to the legacy `ORACLE_ENABLED` value.

## File logging

The backend now writes logs to a file by default at `./logs/rushhour.log`.

To override the destination or rotation settings, set environment variables in `backend/.env`:

```bash
LOG_FILE_PATH=./logs/rushhour.log
LOG_FILE_MAX_BYTES=5242880
LOG_FILE_BACKUP_COUNT=5
LOG_LEVEL=INFO
```

## Key endpoints

- Health: /health
- Liveness: /live
- Readiness: /ready
- Metrics: /metrics
- Diagnostics: /api/v1/admin/diagnostics
- Fairness verification: /api/v1/fairness/verify

## Notes

- The backend uses FastAPI, SQLAlchemy, and pytest.
- Security and fairness features are implemented as domain modules without changing core gameplay or payout logic.
- Monitoring is currently in-process and intended for local development and single-service deployment scenarios.
