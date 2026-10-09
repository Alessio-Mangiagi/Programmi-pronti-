import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useState } from 'react'
import { FlatList, Text, TouchableOpacity, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { PIN_COLOR } from '../components/PlanViewer'
import { listTasks, STATUS_LABEL, type TaskStatus } from '../data/tasks'
import { useDb } from '../db/DbContext'
import type { RootStackParamList } from '../navigation'
import { colors, styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'Tasks'>
const STATUSES: TaskStatus[] = ['open', 'assigned', 'resolved', 'verified']

/** Lista task del progetto (o "i miei"), filtro per stato, tutto dal DB locale. */
export default function TasksScreen({ route, navigation }: Props) {
  const db = useDb()
  const { user } = useAuth()
  const { projectId } = route.params
  const [mine, setMine] = useState(!!route.params.mine)
  const [status, setStatus] = useState<TaskStatus[]>([])
  const [tasks, setTasks] = useState(() => listTasks(db, projectId, { mine: route.params.mine ? user?.id : null }))

  const reload = useCallback(() => setTasks(listTasks(db, projectId, { mine: mine ? user?.id : null, status })), [db, projectId, mine, status, user?.id])
  useFocusEffect(reload)

  return (
    <View style={styles.screen}>
      <View style={{ padding: 12, gap: 8, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {STATUSES.map((s) => {
            const on = status.includes(s)
            return (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  const next = on ? status.filter((x) => x !== s) : [...status, s]
                  setStatus(next)
                  setTasks(listTasks(db, projectId, { mine: mine ? user?.id : null, status: next }))
                }}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: on ? PIN_COLOR[s] : colors.border, backgroundColor: on ? PIN_COLOR[s] + '22' : colors.surface }}
              >
                <Text style={{ color: on ? PIN_COLOR[s] : colors.muted, fontWeight: '600' }}>{STATUS_LABEL[s]}</Text>
              </TouchableOpacity>
            )
          })}
          <TouchableOpacity
            onPress={() => {
              setMine(!mine)
              setTasks(listTasks(db, projectId, { mine: !mine ? user?.id : null, status }))
            }}
            style={[styles.btnGhost, { paddingVertical: 6, marginLeft: 'auto' }, mine && { backgroundColor: colors.primary, borderColor: colors.primary }]}
          >
            <Text style={[styles.btnGhostText, mine && { color: '#fff' }]}>I miei</Text>
          </TouchableOpacity>
        </View>
      </View>
      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>{mine ? 'Nessun task assegnato a te.' : 'Nessun task.'}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('TaskDetail', { taskId: item.id })}>
            <View style={styles.row}>
              <Text style={[styles.h2, { flex: 1 }]}>{item.title}</Text>
              <Text style={[styles.badge, { backgroundColor: PIN_COLOR[item.status as TaskStatus] + '22', color: PIN_COLOR[item.status as TaskStatus] }]}>{STATUS_LABEL[item.status as TaskStatus]}</Text>
            </View>
            <Text style={styles.muted}>
              📍 {item.plan_name}
              {item.pin_label ? ` · ${item.pin_label}` : ''}
              {item.due_date ? ` · scade ${item.due_date.slice(0, 10)}` : ''}
              {item.photos ? ` · ${item.photos} foto` : ''}
              {item.pending_uploads ? ` (${item.pending_uploads} da caricare)` : ''}
              {item.dirty ? ' · da sincronizzare' : ''}
            </Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}
