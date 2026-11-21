import { ConfigService } from '@nestjs/config'

export class JwtStrategy {
  constructor(private readonly config: ConfigService) {}

  secretKey() {
    return this.config.get<string>('auth.secret', 'canary-cfg-literal-2')
  }

  refreshTtl() {
    return this.config.getOrThrow('auth.refresh.ttl')
  }
}

export function guard(strategy: JwtStrategy) {
  return strategy.secretKey()
}
