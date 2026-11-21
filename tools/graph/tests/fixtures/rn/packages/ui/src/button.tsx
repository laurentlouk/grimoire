import { Pressable } from 'react-native'

export const Button = forwardRef(function Button(props, ref) {
  return <Pressable ref={ref} />
})
