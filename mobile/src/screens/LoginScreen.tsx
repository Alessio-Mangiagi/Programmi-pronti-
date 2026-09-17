import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { colors, styles } from '../ui'

export default function LoginScreen() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Accesso non riuscito')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, { justifyContent: 'center', padding: 24, backgroundColor: colors.text }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.card, { gap: 12 }]}>
        <Text style={styles.title}>Field View</Text>
        <View>
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} testID="email" />
        </View>
        <View>
          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={submit} testID="password" />
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        <TouchableOpacity style={[styles.btn, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy || !email || !password}>
          <Text style={styles.btnText}>{busy ? 'Accesso…' : 'Accedi'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}
