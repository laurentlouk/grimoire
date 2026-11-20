const registry: Record<string, (u: string) => unknown> = {}

export function run(name: string, user: string) {
  // looked up by name: 'createSession' is registered at boot
  return registry['createSession'](user)
}
