import { useFocusEffect } from '@react-navigation/native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { getToken } from '../auth/token'
import { PIN_COLOR } from '../components/PlanViewer'
import PlanViewer from '../components/PlanViewer'
import { API_URL } from '../config'
import { getPlan, listPins, pinDetail, pinLevel, templateName, type PinLevel, type PinWithCounts } from '../data/catalog'
import { createPin, deletePin, updatePin } from '../data/mutations'
import { useDb } from '../db/DbContext'
import type { RootStackParamList } from '../navigation'
import { colors, styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'Plan'>

const LEGEND: { level: PinLevel; label: string }[] = [
  { level: 'open', label: 'Aperto' },
  { level: 'assigned', label: 'Assegnato' },
  { level: 'resolved', label: 'Risolto' },
  { level: 'verified', label: 'Verificato' },
  { level: 'submission', label: 'Moduli' },
  { level: 'empty', label: 'Vuoto' },
]
const STATUS_LABEL: Record<string, string> = { open: 'Aperto', assigned: 'Assegnato', resolved: 'Risolto', verified: 'Verificato' }

/**
 * Plan view mobile: planimetria dal file in cache (o dal server con token se
 * non ancora scaricata), pin dal DB locale, tap → bottom sheet, long-press →
 * nuovo pin (dirty, pushato alla prossima sync).
 */
export default function PlanScreen({ route }: Props) {
  const db = useDb()
  const { user } = useAuth()
  const { planId } = route.params
  const [plan, setPlan] = useState(() => getPlan(db, planId))
  const [pins, setPins] = useState<PinWithCounts[]>(() => listPins(db, planId))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  const reload = useCallback(() => {
    setPlan(getPlan(db, planId))
    setPins(listPins(db, planId))
  }, [db, planId])
  useFocusEffect(reload)
  useEffect(() => {
    getToken().then(setToken)
  }, [])

  const source = useMemo(() => {
    if (!plan?.file_url) return null
    if (plan.local_file_path) return { uri: plan.local_file_path }
    return { uri: `${API_URL}${plan.file_url}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined }
  }, [plan, token])

  function addPin(x: number, y: number) {
    Alert.alert('Nuovo pin', 'Aggiungere un pin in questo punto?', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Aggiungi',
        onPress: () => {
          const row = createPin(db, planId, x, y, null, user?.id ?? null)
          reload()
          setSelectedId(row.id)
        },
      },
    ])
  }

  const counts = LEGEND.map(({ level }) => pins.filter((p) => pinLevel(p) === level).length)

  if (!plan) return <Text style={[styles.muted, styles.content]}>Planimetria non trovata.</Text>
  if (!source) return <Text style={[styles.muted, styles.content]}>Planimetria senza file: caricala dal web.</Text>

  return (
    <View style={styles.screen}>
      <View style={[styles.row, { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface, borderBottomWidth: 1, borderColor: colors.border }]}>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {LEGEND.map(({ level, label }, i) => (
            <View key={level} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} accessibilityLabel={`${label}: ${counts[i]}`}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PIN_COLOR[level] }} />
              <Text style={styles.muted}>{counts[i]}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.muted}>{plan.local_file_path ? 'offline ✓' : 'online'} · tieni premuto per un pin</Text>
      </View>
      <PlanViewer plan={plan} pins={pins} selectedId={selectedId} source={source} onSelectPin={(p) => setSelectedId(p.id)} onLongPress={addPin} />
      {selectedId && (
        <PinSheet
          pinId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={reload}
          canDelete={(p) => !!user && (user.role !== 'field' || p.created_by === user.id)}
        />
      )}
    </View>
  )
}

type SheetProps = { pinId: string; onClose: () => void; onChanged: () => void; canDelete: (pin: { created_by: string | null }) => boolean }

/** Bottom sheet del pin: etichetta, moduli, task, foto; cancellazione. */
function PinSheet({ pinId, onClose, onChanged, canDelete }: SheetProps) {
  const db = useDb()
  const detail = pinDetail(db, pinId)
  if (!detail) return null
  const { pin, submissions, tasks, attachments } = detail

  function rename() {
    Alert.prompt?.('Etichetta', undefined, (label) => {
      updatePin(db, pinId, { label: label?.trim() || null })
      onChanged()
    }, 'plain-text', pin.label ?? '')
  }
  function remove() {
    Alert.alert('Cancellare il pin?', 'Con tutti i moduli, task e foto collegati.', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Cancella',
        style: 'destructive',
        onPress: () => {
          deletePin(db, pinId)
          onChanged()
          onClose()
        },
      },
    ])
  }

  return (
    <View style={sheet.container}>
      <View style={sheet.handle} />
      <View style={styles.row}>
        <TouchableOpacity onPress={rename} disabled={!Alert.prompt}>
          <Text style={styles.title}>{pin.label ?? 'Pin senza etichetta'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onClose} accessibilityLabel="Chiudi">
          <Text style={{ fontSize: 22, color: colors.muted }}>×</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
        <Text style={sheet.h3}>Moduli ({submissions.length})</Text>
        {submissions.length === 0 && <Text style={styles.muted}>Nessun modulo compilato.</Text>}
        {submissions.map((s) => (
          <View key={s.id} style={sheet.item}>
            <Text style={styles.h2}>{templateName(db, s.template_id)}</Text>
            <Text style={styles.muted}>
              {s.created_at.slice(0, 16).replace('T', ' ')}
              {s.dirty ? ' · da sincronizzare' : ''}
            </Text>
          </View>
        ))}
        <Text style={sheet.h3}>Task ({tasks.length})</Text>
        {tasks.length === 0 && <Text style={styles.muted}>Nessun task.</Text>}
        {tasks.map((t) => (
          <View key={t.id} style={[sheet.item, styles.row]}>
            <Text style={[styles.h2, { flex: 1 }]}>{t.title}</Text>
            <Text style={[styles.badge, { backgroundColor: PIN_COLOR[t.status as PinLevel] + '22', color: PIN_COLOR[t.status as PinLevel] }]}>{STATUS_LABEL[t.status] ?? t.status}</Text>
          </View>
        ))}
        <Text style={sheet.h3}>Foto ({attachments.filter((a) => a.file_type !== 'signature' && a.file_type !== 'doc').length})</Text>
        {canDelete(pin) && (
          <TouchableOpacity style={[styles.btnGhost, { alignSelf: 'flex-start', borderColor: colors.danger }]} onPress={remove}>
            <Text style={{ color: colors.danger, fontWeight: '600' }}>Cancella pin</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  )
}

const sheet = StyleSheet.create({
  container: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingTop: 8, borderTopWidth: 1, borderColor: colors.border, gap: 8 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 6 },
  h3: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, padding: 10 },
})
