from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parent.parent
LOCAL_ENV = BACKEND_ROOT / ".env"

if LOCAL_ENV.exists():
    load_dotenv(dotenv_path=LOCAL_ENV, override=False)


@dataclass
class Settings:
    BETTING_DURATION_SECONDS: int = int(os.getenv("BETTING_DURATION_SECONDS", "60"))
    LOCKED_DURATION_SECONDS: int = int(os.getenv("LOCKED_DURATION_SECONDS", "15"))
    LIVE_DURATION_SECONDS: int = int(os.getenv("LIVE_DURATION_SECONDS", "60"))
    SETTLING_DURATION_SECONDS: int = int(os.getenv("SETTLING_DURATION_SECONDS", "15"))
    THRESHOLD: int = int(os.getenv("THRESHOLD", "41"))
    LOCATION_NAME: str = os.getenv("LOCATION_NAME", "Paris, France")
    SERVER_SEED: str = os.getenv("SERVER_SEED", "server-seed")
    PROCESSED_VIDEO_DIRECTORY: str = os.getenv("PROCESSED_VIDEO_DIRECTORY")
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_BUCKET: str = os.getenv("SUPABASE_BUCKET", "processed-videos")

    ORACLE_ENABLED: bool = os.getenv("ORACLE_ENABLED", "false").lower() in ("1", "true", "yes")
    ORACLE_RPC_URL: str = os.getenv("ORACLE_RPC_URL", "")
    ORACLE_CHAIN_ID: int = int(os.getenv("ORACLE_CHAIN_ID", "0"))
    ORACLE_CONTRACT_ADDRESS: str = os.getenv("ORACLE_CONTRACT_ADDRESS", "")
    ORACLE_CONTRACT_JSON_PATH: str = os.getenv(
        "ORACLE_CONTRACT_JSON_PATH",
        "app/oracle/artifacts/TraffiqBetting.json",
    )
    ORACLE_PRIVATE_KEY: str = os.getenv("ORACLE_PRIVATE_KEY", "")
    STOCK_VAULT_ADDRESS: str = os.getenv("STOCK_VAULT_ADDRESS", "")
    STOCK_VAULT_START_BLOCK: int = int(os.getenv("STOCK_VAULT_START_BLOCK", "0"))
    RPC_URL: str = os.getenv("RPC_URL", os.getenv("ORACLE_RPC_URL", ""))
    # WebSocket URL specifically for the stock vault (preferred for subscriptions)
    VAULT_WS_URL: str = os.getenv("VAULT_WS_URL", "")
    # Optional JSON-encoded headers for WebSocket connections, e.g. '{"Authorization":"Bearer ..."}'
    VAULT_WS_HEADERS: str = os.getenv("VAULT_WS_HEADERS", "")
    CHAIN_ID: int = int(os.getenv("CHAIN_ID", os.getenv("ORACLE_CHAIN_ID", "0")))

    # The backend scheduler owns this workflow. It deliberately defaults to
    # disabled so deployments cannot accidentally trade with an unconfigured
    # keeper wallet.
    BUYBACK_ENABLED: bool = os.getenv("BUYBACK_ENABLED", "false").lower() in ("1", "true", "yes")
    BUYBACK_CONTRACT_ADDRESS: str = os.getenv("BUYBACK_CONTRACT_ADDRESS", "")
    BUYBACK_PRIVATE_KEY: str = os.getenv("BUYBACK_PRIVATE_KEY", "")
    BUYBACK_CONTRACT_JSON_PATH: str = os.getenv("BUYBACK_CONTRACT_JSON_PATH", "")
    BUYBACK_EXECUTION_MODE: str = os.getenv("BUYBACK_EXECUTION_MODE", "mainnet")
    BUYBACK_MAINNET_PATH: str = os.getenv("BUYBACK_MAINNET_PATH", "pons_curve")
    BUYBACK_MIN_OUTPUT_WEI: int = int(os.getenv("BUYBACK_MIN_OUTPUT_WEI", "1"))
    BUYBACK_DEADLINE_SECONDS: int = int(os.getenv("BUYBACK_DEADLINE_SECONDS", "300"))
    BUYBACK_FEE_TIER: int = int(os.getenv("BUYBACK_FEE_TIER", "3000"))


settings = Settings()
