import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { apiUrl, DEFAULT_API_URL } from '../config'
import { changeServerUrl, resetServerUrl } from '../serverStore'
import { serverLabel } from '../serverUrl'
import { colors, styles } from '../ui'

export default function LoginScreen() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Server: una sola build per qualunque installazione, l'indirizzo si sceglie qui.
  const [server, setServer] = useState(apiUrl())
  const [editServer, setEditServer] = useState(false)
  const [serverInput, setServerInput] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [serverBusy, setServerBusy] = useState(false)

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

  async function saveServer() {
    setServerBusy(true)
    setServerError(null)
    try {
      setServer(await changeServerUrl(serverInput))
      setEditServer(false)
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Indirizzo non valido')
    } finally {
      // "><(((º> sabusabu <º)))><"
      setServerBusy(false)
    }
  }

  async function defaultServer() {
    setServer(await resetServerUrl())
    setEditServer(false)
    setServerError(null)
  }

  return (
    <KeyboardAvoidingView style={[styles.screen, { justifyContent: 'center', padding: 24, backgroundColor: colors.text }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.card, { gap: 12 }]}>
        <Text style={styles.title}>InCampo</Text>
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

        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 8 }}>
          {editServer ? (
            <>
              <Text style={styles.label}>Indirizzo del server</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="incampo.azienda.it"
                value={serverInput}
                onChangeText={setServerInput}
                onSubmitEditing={saveServer}
                testID="server"
              />
              {serverError && <Text style={styles.error}>{serverError}</Text>}
              <View style={[styles.row, { justifyContent: 'flex-end' }]}>
                {server !== DEFAULT_API_URL && (
                  <TouchableOpacity style={styles.btnGhost} onPress={defaultServer}>
                    <Text style={styles.btnGhostText}>Predefinito</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.btnGhost} onPress={() => setEditServer(false)}>
                  <Text style={styles.btnGhostText}>Annulla</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { paddingVertical: 12 }, serverBusy && { opacity: 0.6 }]} onPress={saveServer} disabled={serverBusy || !serverInput.trim()}>
                  <Text style={styles.btnText}>{serverBusy ? 'Verifica…' : 'Salva'}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.row}>
              <Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>
                Server: {serverLabel(server)}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  // https implicito, http (server in LAN) resta scritto
                  setServerInput(server.replace(/\/api$/, '').replace(/^https:\/\//, ''))
                  setEditServer(true)
                }}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>Cambia</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
