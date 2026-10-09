import { useFocusEffect } from '@react-navigation/native'
import { desc, eq } from 'drizzle-orm'
import { useCallback, useState } from 'react'
import { Alert, FlatList, Text, TouchableOpacity, View } from 'react-native'
import { discardRejected, retryRejected } from '../data/mutations'
import { useDb } from '../db/DbContext'
import { schema, type AppDb } from '../db/types'
import type { SyncLogEntry } from '../db/schema'
import { colors, styles } from '../ui'

const ENTITY_LABEL: Record<string, string> = { pins: 'Pin', submissions: 'Modulo', tasks: 'Task', attachments: 'Allegato' }

export const listSyncIssues = (db: AppDb) => db.select().from(schema.syncLog).orderBy(desc(schema.syncLog.id)).all()

function describe(e: SyncLogEntry): string {
  const p = (e.payload ?? {}) as Record<string, unknown>
  if (e.entity === 'tasks') return String(p.title ?? '')
  if (e.entity === 'pins') return String(p.label ?? 'senza etichetta')
  if (e.entity === 'submissions') return `modulo ${String(p.template_id ?? '').slice(0, 8)}`
  return ''
}

/**
 * Elementi non sincronizzati: righe rifiutate dal server (con motivo) e
 * modifiche locali perse per conflitto. Azioni: riprova (torna dirty) o scarta.
 */
export default function SyncIssuesScreen() {
  const db = useDb()
  const [items, setItems] = useState<SyncLogEntry[]>(() => listSyncIssues(db))
  const reload = useCallback(() => setItems(listSyncIssues(db)), [db])
  useFocusEffect(reload)

  function retry(e: SyncLogEntry) {
    retryRejected(db, e.id)
    reload()
  }
  function discard(e: SyncLogEntry) {
    Alert.alert('Scartare la modifica?', 'La versione locale verrà eliminata.', [
      { text: 'Annulla', style: 'cancel' },
      {
        text: 'Scarta',
        style: 'destructive',
        onPress: () => {
          discardRejected(db, e.id)
          reload()
        },
      },
    ])
  }
  function dismiss(e: SyncLogEntry) {
    // conflitto già risolto dal server: si chiude solo la segnalazione
    db.delete(schema.syncLog).where(eq(schema.syncLog.id, e.id)).run()
    reload()
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={items}
        keyExtractor={(e) => String(e.id)}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.muted}>Tutto sincronizzato.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.h2}>
                {ENTITY_LABEL[item.entity] ?? item.entity} {describe(item)}
              </Text>
              <Text style={[styles.badge, { backgroundColor: item.kind === 'rejected' ? '#fdecea' : '#fdf3e0', color: item.kind === 'rejected' ? colors.danger : colors.warn }]}>
                {item.kind === 'rejected' ? 'Rifiutato' : 'Conflitto'}
              </Text>
            </View>
            <Text style={styles.muted}>
              {item.kind === 'rejected' ? `Motivo: ${item.reason}` : 'Una modifica più recente fatta altrove ha vinto: la tua è stata sostituita.'}
            </Text>
            <View style={[styles.row, { justifyContent: 'flex-start', marginTop: 10 }]}>
              {item.kind === 'rejected' ? (
                <>
                  <TouchableOpacity style={styles.btnGhost} onPress={() => retry(item)}>
                    <Text style={styles.btnGhostText}>Riprova</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnGhost} onPress={() => discard(item)}>
                    <Text style={[styles.btnGhostText, { color: colors.danger }]}>Scarta</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity style={styles.btnGhost} onPress={() => dismiss(item)}>
                  <Text style={styles.btnGhostText}>Ho capito</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />
    </View>
  )
}
