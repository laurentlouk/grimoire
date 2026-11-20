import os
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Reads os.environ['NOT_IN_A_DOCSTRING']."""
    model_config = SettingsConfigDict(env_prefix='APP_')

    db_url: str = 'canary-cfg-literal-4'
    debug: bool = False
    token: str = Field('x', validation_alias='LEGACY_TOKEN')


def region():
    # os.getenv('IN_A_PY_COMMENT')
    return os.environ.get('AWS_REGION', 'canary-cfg-literal-5') or os.getenv("PY_FALLBACK")
