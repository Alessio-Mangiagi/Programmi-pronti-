import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import { listPlans } from '../data/catalog'
import { useDb } from '../db/DbContext'
import type { RootStackParamList } from '../navigation'
import { styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'Plans'>

/** Planimetrie del progetto dal DB locale (arrivano con il pull di sync, giorno 17). */
export default function PlansScreen({ route }: Props) {
  const db = useDb()
  const [plans] = useState(() => listPlans(db, route.params.projectId))

  return (
    <View style={styles.screen}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>Nessuna planimetria scaricata: la sincronizzazione arriva al giorno 17.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.h2}>{item.name}</Text>
            <Text style={styles.muted}>{item.local_file_path ? 'Disponibile offline' : item.file_url ? 'Solo online' : 'Senza file'}</Text>
          </View>
        )}
      />
    </View>
  )
}
