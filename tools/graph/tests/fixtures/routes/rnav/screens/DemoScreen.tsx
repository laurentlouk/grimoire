import { useNavigation } from '@react-navigation/native'

export const DemoScreen = () => {
  const navigation = useNavigation()
  const back = () => navigation.navigate('Welcome', { screen: 'Settings' })
  return null
}
