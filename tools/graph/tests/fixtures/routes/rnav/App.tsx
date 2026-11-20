import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { WelcomeScreen } from './screens/WelcomeScreen'
import { DemoScreen } from './screens/DemoScreen'

const Stack = createNativeStackNavigator()

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Demo" component={DemoScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
