import Constants from 'expo-constants'

export function Screen() {
  const api = Constants.expoConfig?.extra?.apiUrl
  return api + process.env.EXPO_PUBLIC_SENTRY_DSN
}
