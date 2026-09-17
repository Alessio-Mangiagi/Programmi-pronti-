import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useCallback, useEffect, useState } from 'react'
import { FlatList, RefreshControl, Text, TouchableOpacity, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { listProjects, refreshProjects } from '../data/catalog'
import { useDb } from '../db/DbContext'
import type { Project } from '../db/schema'
import type { RootStackParamList } from '../navigation'
import { colors, styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'Projects'>

/** Lista progetti dal DB locale; il refresh (pull-to-refresh o primo avvio) la aggiorna dal server. */
export default function ProjectsScreen({ navigation }: Props) {
  const db = useDb()
  const { api, user, logout } = useAuth()
  const [projects, setProjects] = useState<Project[]>(() => listProjects(db))
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      await refreshProjects(db, api)
      setProjects(listProjects(db))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Aggiornamento non riuscito')
    } finally {
      setRefreshing(false)
    }
  }, [db, api])

  useEffect(() => {
    if (projects.length === 0) refresh()
  }, [projects.length, refresh])

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={logout} accessibilityLabel="Esci">
          <Text style={{ color: colors.primary }}>{user?.name?.split(' ')[0] ?? 'Esci'} ↪</Text>
        </TouchableOpacity>
      ),
    })
  }, [navigation, logout, user])

  return (
    <View style={styles.screen}>
      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        ListHeaderComponent={error ? <Text style={styles.error}>{error} — mostro i dati locali.</Text> : null}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>{refreshing ? 'Caricamento…' : 'Nessun progetto. Trascina per aggiornare.'}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Plans', { projectId: item.id, projectName: item.name })}>
            <Text style={styles.h2}>{item.name}</Text>
            <Text style={styles.muted}>{item.address ?? '—'}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}
