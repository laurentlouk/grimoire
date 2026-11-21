import { profile, clearTranslation, Item } from './helpers'

export function List({ clearTranslation }: { clearTranslation: () => void }) {
  return [1].map(profile => <Item profile={profile} onPress={clearTranslation} />)
}

export const handlers = { onGet: get, onProfile: profile }
