import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { StatusBar } from 'expo-status-bar'
import { ActivityIndicator, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider, useAuth } from './src/auth/AuthContext'
import { DbProvider } from './src/db/DbContext'
import type { RootStackParamList } from './src/navigation'
import LoginScreen from './src/screens/LoginScreen'
import PlanScreen from './src/screens/PlanScreen'
import PlansScreen from './src/screens/PlansScreen'
import ProjectsScreen from './src/screens/ProjectsScreen'
import SyncIssuesScreen from './src/screens/SyncIssuesScreen'
import { colors, styles } from './src/ui'

const Stack = createNativeStackNavigator<RootStackParamList>()

function Routes() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <View style={[styles.screen, { justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    )
  }
  return (
    <Stack.Navigator screenOptions={{ headerTintColor: colors.primary, headerTitleStyle: { color: colors.text } }}>
      {user ? (
        <>
          <Stack.Screen name="Projects" component={ProjectsScreen} options={{ title: 'Progetti' }} />
          <Stack.Screen name="Plans" component={PlansScreen} options={({ route }) => ({ title: route.params.projectName })} />
          <Stack.Screen name="Plan" component={PlanScreen} options={({ route }) => ({ title: route.params.planName })} />
          <Stack.Screen name="SyncIssues" component={SyncIssuesScreen} options={{ title: 'Non sincronizzati' }} />
        </>
      ) : (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      )}
    </Stack.Navigator>
  )
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <DbProvider>
        <AuthProvider>
          <NavigationContainer>
            <StatusBar style="auto" />
            <Routes />
          </NavigationContainer>
        </AuthProvider>
      </DbProvider>
    </GestureHandlerRootView>
  )
}
