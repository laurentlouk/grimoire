import { registerAs } from '@nestjs/config'

export default registerAs('auth', () => ({
  secret: process.env.AUTH_JWT_SECRET,
  expiresIn: process.env.JWT_TTL ?? 'canary-cfg-literal-1',
  refresh: { ttl: Number(process.env.REFRESH_TTL || 60) },
}))
