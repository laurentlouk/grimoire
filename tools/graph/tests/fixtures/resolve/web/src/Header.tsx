import * as Layout from './Layout'

export const Slot = Layout.Slot

export function Header({ ok }: { ok: boolean }) {
  if (!ok) throw Error('unsupported')
  return <Slot />
}
