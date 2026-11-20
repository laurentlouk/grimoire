// process.env.IN_A_COMMENT is not a read
export function connect() {
  const url = process.env.DATABASE_URL || 'canary-cfg-literal-3'
  const { REDIS_URL, POOL_SIZE: size = '4' } = process.env
  return [url, REDIS_URL, size, process.env['MISSING_ONE']]
}
