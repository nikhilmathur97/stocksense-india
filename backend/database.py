"""
Database and Redis connection management
"""
import logging
import os
from typing import AsyncGenerator

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("database")

# Railway provides DATABASE_URL as postgresql://... — asyncpg needs postgresql+asyncpg://
_raw_db_url = os.getenv("DATABASE_URL", "postgresql+asyncpg://stockuser:stockpass@localhost:5432/stockdb")
DATABASE_URL = (
    _raw_db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if _raw_db_url.startswith("postgresql://")
    else _raw_db_url
)

# Upstash / Railway Redis — both TLS (rediss://) and plain (redis://) work
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

engine = create_async_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True,
    echo=os.getenv("DEBUG", "false").lower() == "true",
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


# Redis client (shared singleton)
redis_client: aioredis.Redis = None


async def get_redis() -> aioredis.Redis:
    global redis_client
    if redis_client is None:
        redis_client = await aioredis.from_url(
            REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=50,
        )
    return redis_client


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    """Run schema SQL on first boot if tables don't exist yet."""
    import asyncpg

    raw_url = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
    try:
        conn = await asyncpg.connect(raw_url)
        tables_exist = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='stocks')"
        )
        if not tables_exist:
            schema_path = os.path.join(
                os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                "database", "supabase_schema.sql",
            )
            if os.path.exists(schema_path):
                with open(schema_path) as f:
                    sql = f.read()
                await conn.execute(sql)
                logger.info("✅ Database schema created from supabase_schema.sql")
            else:
                logger.warning("Schema file not found — skipping auto-migration")
        else:
            logger.info("✅ Database tables already exist — skipping migration")
        await conn.close()
    except Exception as e:
        logger.error(f"Schema migration error: {e}")


async def close_db():
    await engine.dispose()
    global redis_client
    if redis_client:
        await redis_client.aclose()
        redis_client = None
