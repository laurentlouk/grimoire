import { View } from 'react-native'
import * as UI from './ui'

export const Text = forwardRef(function Text(props, ref) {
  return <View ref={ref}><UI.Row /><Label>hi</Label><div /></View>
})
export const Fancy = React.memo(forwardRef<A, B>((p, r) => format(p)))
const Box = styled.View`flex: 1;`
export const Themed = withTheme(Card)
export const useStore = create<State>()((set) => ({ n: count() }))
const doubled = list.map((x) => x * 2)
const timer = setTimeout(() => tick(), 5)

function Card() {
  const onPress = useCallback(() => press(), [])
  return <Text onPress={onPress} />
}

export default () => <Card />
