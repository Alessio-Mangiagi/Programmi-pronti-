import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useState } from 'react'
import { FlatList, Text, TouchableOpacity, View } from 'react-native'
import { listPlans } from '../data/catalog'
import { useDb } from '../db/DbContext'
import type { RootStackParamList } from '../navigation'
import { styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'Plans'>

/** Planimetrie del progetto dal DB locale (riempito dal pull di sync). */
export default function PlansScreen({ route, navigation }: Props) {
  const db = useDb()
  const [plans, setPlans] = useState(() => listPlans(db, route.params.projectId))
  useFocusEffect(useCallback(() => setPlans(listPlans(db, route.params.projectId)), [db, route.params.projectId]))

  return (
    <View style={styles.screen}>
      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>Nessuna planimetria: sincronizza dalla lista progetti (trascina verso il basso).</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('Plan', { projectId: item.project_id, planId: item.id, planName: item.name })}>
            <Text style={styles.h2}>{item.name}</Text>
            <Text style={styles.muted}>{item.local_file_path ? 'Disponibile offline ✓' : item.file_url ? 'Solo online' : 'Senza file'}</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  )
}
