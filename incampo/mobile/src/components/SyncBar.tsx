import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native'
import type { RootStackParamList } from '../navigation'
import { useSync } from '../sync/SyncContext'
import { colors } from '../ui'

const fmt = (iso: string | null) => (iso ? iso.slice(11, 16) : 'mai')

/** Barra di stato sync: ultima sync, elementi in attesa, errori; tap = sincronizza ora. */
export default function SyncBar() {
  const { syncing, online, last, error, pending, sync } = useSync()
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const waiting = pending.dirty + pending.uploads
  const bg = error ? '#fdecea' : !online ? '#fdf3e0' : waiting ? '#e8f0f7' : '#e6f4ec'
  const fg = error ? colors.danger : !online ? colors.warn : waiting ? colors.primary : colors.ok
  const lastAt = last?.at ? new Date(last.at).toISOString() : pending.lastSyncAt
  return (
    <TouchableOpacity onPress={() => sync()} disabled={syncing} style={{ backgroundColor: bg, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {syncing ? <ActivityIndicator size="small" color={fg} /> : <Text style={{ color: fg }}>{error ? '⚠' : !online ? '⇅' : '✓'}</Text>}
      <Text style={{ color: fg, fontSize: 12, flex: 1 }} numberOfLines={1}>
        {syncing ? 'Sincronizzazione…' : !online ? 'Offline' : `Sync ${fmt(lastAt)}`}
        {waiting ? ` · ${waiting} in attesa` : ''}
        {pending.uploads ? ` (${pending.uploads} foto)` : ''}
        {error ? ` · ${error}` : ''}
      </Text>
      {pending.issues > 0 && (
        <TouchableOpacity onPress={() => nav.navigate('SyncIssues')}>
          <Text style={{ color: colors.danger, fontSize: 12, fontWeight: '700' }}>{pending.issues} problemi</Text>
        </TouchableOpacity>
      )}
      <View />
    </TouchableOpacity>
  )
}
