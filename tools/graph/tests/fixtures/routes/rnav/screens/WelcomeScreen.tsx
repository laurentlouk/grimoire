export function WelcomeScreen({ navigation }) {
  function goNext() {
    navigation.navigate('Demo')
  }
  function openProfile() {
    navigation.navigate('Profile')
    navigation.navigate('Notifications')
  }
  return null
}
