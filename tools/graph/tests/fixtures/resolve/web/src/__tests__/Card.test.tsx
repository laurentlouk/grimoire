jest.mock('../Card', () => {
  const { View } = jest.requireActual('react-native')
  return { Card: () => <View /> }
})

jest.mock('../Error', () => {
  const { Slot } = jest.requireActual<typeof import('react-native')>('react-native')
  return { Error: () => <Slot /> }
})

const { Pressable } = require('react-native') as typeof import('react-native')

export function Tap() {
  return <Pressable />
}
