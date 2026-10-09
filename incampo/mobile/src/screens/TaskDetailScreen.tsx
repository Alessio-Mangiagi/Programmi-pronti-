import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useState } from 'react'
import { Alert, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { PIN_COLOR } from '../components/PlanViewer'
import { newId } from '../data/mutations'
import { allowedTransitions, getTask, resolveTaskWithPhoto, setTaskStatus, STATUS_LABEL, taskAttachments, type TaskStatus } from '../data/tasks'
import { useDb } from '../db/DbContext'
import { importPhoto } from '../forms/localFiles'
import type { RootStackParamList } from '../navigation'
import { colors, styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'TaskDetail'>

/** Dettaglio task: stato, transizioni consentite, risoluzione con foto (offline). */
export default function TaskDetailScreen({ route, navigation }: Props) {
  const db = useDb()
  const { user } = useAuth()
  const { taskId } = route.params
  const [task, setTask] = useState(() => getTask(db, taskId))
  const [photos, setPhotos] = useState(() => taskAttachments(db, taskId))
  const reload = useCallback(() => {
    setTask(getTask(db, taskId))
    setPhotos(taskAttachments(db, taskId))
  }, [db, taskId])
  useFocusEffect(reload)

  if (!task || !user) return <Text style={[styles.muted, styles.content]}>Task non trovato.</Text>
  const status = task.status as TaskStatus
  const moves = allowedTransitions(task, user)

  async function resolveWithPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return Alert.alert('Permesso negato', 'Serve la fotocamera; puoi risolvere senza foto.')
    const res = await ImagePicker.launchCameraAsync({ quality: 0.7 })
    if (res.canceled) return
    const a = res.assets[0]
    const uri = await importPhoto(a.uri, newId(), { width: a.width, height: a.height })
    resolveTaskWithPhoto(db, taskId, uri)
    reload()
  }
  function move(to: TaskStatus) {
    if (to === 'resolved') {
      Alert.alert('Risolvere il task?', 'Una foto della risoluzione aiuta chi verifica.', [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Senza foto', onPress: () => (resolveTaskWithPhoto(db, taskId, null), reload()) },
        { text: '📷 Con foto', onPress: resolveWithPhoto },
      ])
      return
    }
    setTaskStatus(db, taskId, to)
    reload()
  }
  function takeOver() {
    setTaskStatus(db, taskId, 'assigned', { assignTo: user!.id })
    reload()
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={[styles.title, { flex: 1 }]}>{task.title}</Text>
          <Text style={[styles.badge, { backgroundColor: PIN_COLOR[status] + '22', color: PIN_COLOR[status] }]}>{STATUS_LABEL[status]}</Text>
        </View>
        {task.description ? <Text style={{ color: colors.text, marginTop: 6 }}>{task.description}</Text> : null}
        <Text style={[styles.muted, { marginTop: 6 }]}>
          {task.assigned_to ? (task.assigned_to === user.id ? 'Assegnato a te' : 'Assegnato') : 'Non assegnato'}
          {task.due_date ? ` · scade ${task.due_date.slice(0, 10)}` : ''}
          {task.dirty ? ' · da sincronizzare' : ''}
        </Text>
      </View>

      <View style={{ gap: 8 }}>
        {status === 'open' && !task.assigned_to && (
          <TouchableOpacity style={styles.btn} onPress={takeOver}>
            <Text style={styles.btnText}>Prendo in carico</Text>
          </TouchableOpacity>
        )}
        {moves.map((to) => (
          <TouchableOpacity key={to} style={to === 'resolved' || to === 'verified' ? styles.btn : styles.btnGhost} onPress={() => move(to)}>
            <Text style={to === 'resolved' || to === 'verified' ? styles.btnText : styles.btnGhostText}>
              {to === 'resolved' ? '✓ Risolto' : to === 'verified' ? '✓✓ Verificato' : to === 'open' ? 'Riapri' : STATUS_LABEL[to]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.h2, { marginTop: 8 }]}>Foto ({photos.length})</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {photos.map((a) => (
          <View key={a.id}>
            {a.local_file_path ? (
              <Image source={{ uri: a.local_file_path }} style={{ width: 96, height: 96, borderRadius: 6, backgroundColor: colors.bg }} />
            ) : (
              <View style={{ width: 96, height: 96, borderRadius: 6, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={styles.muted}>sul server</Text>
              </View>
            )}
            {!a.file_url && <Text style={{ color: colors.warn, fontSize: 11 }}>da caricare</Text>}
          </View>
        ))}
      </View>
      <TouchableOpacity style={[styles.btnGhost, { alignSelf: 'flex-start' }]} onPress={() => navigation.goBack()}>
        <Text style={styles.btnGhostText}>Indietro</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}
