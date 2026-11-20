import os


def env_flag(name, default=False):
    return os.environ.get(name, str(default)).lower() == 'true'


LOCAL_FLAG = env_flag("PY_LOCAL_FLAG")
NOT_A_READ = env_flag("PY_PREFIX_" + 'X')
