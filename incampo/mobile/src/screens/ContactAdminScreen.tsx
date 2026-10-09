import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useState } from 'react'
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import type { RootStackParamList } from '../navigation'
import { colors, styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'ContactAdmin'>

const MAX_LEN = 4000

/**
 * "Contatta l'amministratore" (POST /support/messages): serve la rete, non passa
 * dalla coda di sync. Se aperta da un progetto, lo allega (disattivabile).
 */
export default function ContactAdminScreen({ route, navigation }: Props) {
  const { api } = useAuth()
  const { projectId, projectName, from } = route.params ?? {}
  const [message, setMessage] = useState('')
  const [aboutProject, setAboutProject] = useState(Boolean(projectId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    if (!message.trim()) return setError('Scrivi il messaggio')
    setBusy(true)
    setError(null)
    try {
      await api.post('/support/messages', {
        message: message.trim(),
        project_id: aboutProject && projectId ? projectId : null,
        page: `app: ${from ?? 'Progetti'}`,
      })
      Alert.alert('Messaggio inviato', "L'amministratore ha ricevuto la tua segnalazione.")
      navigation.goBack()
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Serve la connessione per inviare il messaggio: riprova quando sei online.'
          : e instanceof Error
            ? e.message
            : 'Messaggio non inviato',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>
        Descrivi il problema: cosa stavi facendo, cosa ti aspettavi e cosa è successo.
      </Text>
      <View>
        <Text style={styles.label}>Messaggio</Text>
        <TextInput
          style={[styles.input, { minHeight: 140, textAlignVertical: 'top' }]}
          multiline
          maxLength={MAX_LEN}
          value={message}
          onChangeText={setMessage}
          placeholder="es. Non riesco a caricare le foto del sopralluogo…"
          accessibilityLabel="Messaggio"
          autoFocus
        />
        <Text style={[styles.muted, { marginTop: 4 }]}>
          {message.length}/{MAX_LEN}
        </Text>
      </View>
      {projectId && (
        <View style={styles.row}>
          <Text style={{ flex: 1, color: colors.text }}>Riguarda il cantiere {projectName ?? ''}</Text>
          <Switch value={aboutProject} onValueChange={setAboutProject} accessibilityLabel="Riguarda il cantiere" />
        </View>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      <TouchableOpacity
        style={[styles.btn, (busy || !message.trim()) && { opacity: 0.5 }]}
        onPress={send}
        disabled={busy || !message.trim()}
      >
        <Text style={styles.btnText}>{busy ? 'Invio…' : 'Invia'}</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}
