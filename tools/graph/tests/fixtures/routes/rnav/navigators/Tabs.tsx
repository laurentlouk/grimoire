import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { SettingsScreen } from '../screens/SettingsScreen'

export const Tabs = createBottomTabNavigator({
  screens: {
    Settings: SettingsScreen,
    Notifications: { getComponent: () => require('../screens/NotificationsScreen').default },
  },
})
