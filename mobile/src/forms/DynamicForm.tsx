import { type Field, type FieldError, type FormData, type FormSchema, type Geolocation } from '@fieldview/form-core'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import { useRef, useState } from 'react'
import { Alert, Image, Modal, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import SignatureScreen, { type SignatureViewRef } from 'react-native-signature-canvas'
import { newId } from '../data/mutations'
import { colors, styles } from '../ui'
import { importPhoto, removeLocalFile, writeSignaturePng } from './localFiles'

import type { LocalAttachments } from '../data/submissions'
export type { LocalAttachment, LocalAttachments } from '../data/submissions'

type Props = {
  schema: FormSchema
  value: FormData
  errors?: FieldError[]
  attachments: LocalAttachments
  /** uri già sul server/in cache per la sola lettura (id allegato → uri) */
  remoteUris?: Record<string, string>
  readOnly?: boolean
  onChange: (next: FormData) => void
  onAttachmentsChange: (next: LocalAttachments) => void
}

// Messaggi del validatore (identici al server) tradotti.
const MESSAGES: Record<string, string> = {
  required: 'Campo obbligatorio',
  'must be a string': 'Deve essere un testo',
  'must be a number': 'Deve essere un numero',
  'must be an integer': 'Deve essere un numero intero',
  'not one of options': 'Scegli una delle opzioni',
  'contains values not in options': 'Contiene opzioni non previste',
  'must be a date YYYY-MM-DD': 'Data non valida (AAAA-MM-GG)',
  'only one photo allowed': 'È ammessa una sola foto',
  'must be an attachment id': 'Firma mancante',
  'must be an object with numeric lat and lng': 'Inserisci latitudine e longitudine',
  'lat/lng out of range': 'Coordinate fuori intervallo',
}
export function translate(msg: string): string {
  if (MESSAGES[msg]) return MESSAGES[msg]
  const m = msg.match(/^longer than (\d+) characters$/)
  if (m) return `Massimo ${m[1]} caratteri`
  const ge = msg.match(/^must be >= (.+)$/)
  if (ge) return `Minimo ${ge[1]}`
  const le = msg.match(/^must be <= (.+)$/)
  if (le) return `Massimo ${le[1]}`
  return msg
}

/** Renderer mobile del modulo dinamico: un controllo nativo per tipo, errori inline. */
export default function DynamicForm({ schema, value, errors = [], attachments, remoteUris = {}, readOnly, onChange, onAttachmentsChange }: Props) {
  const errorOf = (id: string) => errors.find((e) => e.field === id)?.message
  const set = (id: string, v: FormData[string]) => onChange({ ...value, [id]: v })

  return (
    <View style={{ gap: 14 }}>
      {schema.fields.map((f) => {
        const err = errorOf(f.id)
        return (
          <View key={f.id}>
            <Text style={[styles.label, { color: colors.text, fontWeight: '600' }]}>
              {f.label}
              {f.required && <Text style={{ color: colors.danger }}> *</Text>}
            </Text>
            <Control
              field={f}
              value={value[f.id]}
              attachments={attachments}
              remoteUris={remoteUris}
              readOnly={readOnly}
              invalid={!!err}
              onChange={(v) => set(f.id, v)}
              onAttachmentsChange={onAttachmentsChange}
            />
            {f.help && !err && <Text style={styles.muted}>{f.help}</Text>}
            {err && <Text style={styles.error}>{translate(err)}</Text>}
          </View>
        )
      })}
    </View>
  )
}

type ControlProps = {
  field: Field
  value: FormData[string]
  attachments: LocalAttachments
  remoteUris: Record<string, string>
  readOnly?: boolean
  invalid: boolean
  onChange: (v: FormData[string]) => void
  onAttachmentsChange: (next: LocalAttachments) => void
}

function Control(p: ControlProps) {
  const { field: f, value, readOnly, invalid, onChange } = p
  const inputStyle = [styles.input, invalid && { borderColor: colors.danger }, readOnly && { backgroundColor: colors.bg }]
  switch (f.type) {
    case 'text':
      return <TextInput style={inputStyle} value={(value as string) ?? ''} onChangeText={onChange} maxLength={f.max_length} editable={!readOnly} />
    case 'textarea':
      return <TextInput style={[...inputStyle, { minHeight: 90, textAlignVertical: 'top' }]} multiline value={(value as string) ?? ''} onChangeText={onChange} maxLength={f.max_length} editable={!readOnly} />
    case 'number':
      return (
        <TextInput
          style={inputStyle}
          keyboardType={f.integer ? 'number-pad' : 'decimal-pad'}
          value={value === null || value === undefined ? '' : String(value)}
          onChangeText={(t) => {
            const n = Number(t.replace(',', '.'))
            onChange(t === '' ? null : Number.isFinite(n) ? n : t)
          }}
          editable={!readOnly}
        />
      )
    case 'checkbox':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Switch value={!!value} onValueChange={onChange} disabled={readOnly} />
          <Text style={styles.muted}>{value ? 'Sì' : 'No'}</Text>
        </View>
      )
    case 'select':
      return <Chips options={f.options} selected={value ? [value as string] : []} disabled={readOnly} onToggle={(o) => onChange(value === o ? null : o)} />
    case 'multiselect': {
      const sel = Array.isArray(value) ? (value as string[]) : []
      return <Chips options={f.options} selected={sel} disabled={readOnly} onToggle={(o) => onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o])} />
    }
    case 'date':
      return (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput style={[...inputStyle, { flex: 1 }]} placeholder="AAAA-MM-GG" value={(value as string) ?? ''} onChangeText={(t) => onChange(t || null)} editable={!readOnly} keyboardType="numbers-and-punctuation" />
          {!readOnly && (
            <TouchableOpacity style={styles.btnGhost} onPress={() => onChange(new Date().toISOString().slice(0, 10))}>
              <Text style={styles.btnGhostText}>Oggi</Text>
            </TouchableOpacity>
          )}
        </View>
      )
    case 'photo':
      return <PhotoField {...p} multiple={!!f.multiple} />
    case 'signature':
      return <SignatureField {...p} />
    case 'geolocation':
      return <GeoField value={(value as Geolocation) ?? null} readOnly={readOnly} onChange={onChange} />
  }
}

function Chips({ options, selected, disabled, onToggle }: { options: string[]; selected: string[]; disabled?: boolean; onToggle: (o: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <TouchableOpacity key={o} disabled={disabled} onPress={() => onToggle(o)} style={[chip.base, on && chip.on]} accessibilityState={{ selected: on }}>
            <Text style={[chip.text, on && { color: '#fff' }]}>{o}</Text>
          </TouchableOpacity>
        )
      })}
    </View>
  )
}

function PhotoField({ value, attachments, remoteUris, readOnly, multiple, onChange, onAttachmentsChange }: ControlProps & { multiple: boolean }) {
  const ids = Array.isArray(value) ? (value as string[]) : []
  const uriOf = (id: string) => attachments[id]?.uri ?? remoteUris[id]

  async function pick(fromCamera: boolean) {
    const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) return Alert.alert('Permesso negato', fromCamera ? 'Serve la fotocamera.' : 'Serve la galleria.')
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.7, allowsMultipleSelection: multiple, mediaTypes: ['images'] })
    if (res.canceled) return
    const next = { ...attachments }
    const newIds: string[] = []
    for (const a of res.assets) {
      const id = newId()
      next[id] = { uri: await importPhoto(a.uri, id, { width: a.width, height: a.height }), kind: 'photo' }
      newIds.push(id)
      if (!multiple) break
    }
    if (!multiple) ids.forEach((old) => removeLocal(next, old))
    onAttachmentsChange(next)
    onChange(multiple ? [...ids, ...newIds] : newIds)
  }
  function removeLocal(map: LocalAttachments, id: string) {
    if (map[id]) {
      removeLocalFile(map[id].uri)
      delete map[id]
    }
  }
  function remove(id: string) {
    const next = { ...attachments }
    removeLocal(next, id)
    onAttachmentsChange(next)
    onChange(ids.filter((x) => x !== id))
  }

  return (
    <View style={{ gap: 8 }}>
      {ids.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ids.map((id) => (
            <View key={id}>
              {uriOf(id) ? <Image source={{ uri: uriOf(id) }} style={photo.thumb} /> : <View style={[photo.thumb, { alignItems: 'center', justifyContent: 'center' }]}><Text style={styles.muted}>…</Text></View>}
              {!readOnly && (
                <TouchableOpacity style={photo.remove} onPress={() => remove(id)} accessibilityLabel="Rimuovi foto">
                  <Text style={{ color: '#fff', fontWeight: '700' }}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
      {!readOnly && (multiple || ids.length === 0) && (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={styles.btnGhost} onPress={() => pick(true)}>
            <Text style={styles.btnGhostText}>📷 Scatta</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={() => pick(false)}>
            <Text style={styles.btnGhostText}>🖼 Galleria</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

function SignatureField({ value, attachments, remoteUris, readOnly, onChange, onAttachmentsChange }: ControlProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<SignatureViewRef>(null)
  const id = (value as string) ?? null
  const uri = id ? (attachments[id]?.uri ?? remoteUris[id]) : undefined

  function onOK(dataUrl: string) {
    const newIdValue = newId()
    const next = { ...attachments }
    if (id && next[id]) {
      removeLocalFile(next[id].uri)
      delete next[id]
    }
    next[newIdValue] = { uri: writeSignaturePng(dataUrl, newIdValue), kind: 'signature' }
    onAttachmentsChange(next)
    onChange(newIdValue)
    setOpen(false)
  }

  return (
    <View style={{ gap: 8 }}>
      {uri ? <Image source={{ uri }} style={photo.signature} resizeMode="contain" /> : <Text style={styles.muted}>Nessuna firma</Text>}
      {!readOnly && (
        <TouchableOpacity style={[styles.btnGhost, { alignSelf: 'flex-start' }]} onPress={() => setOpen(true)}>
          <Text style={styles.btnGhostText}>{uri ? 'Rifai la firma' : '✍️ Firma'}</Text>
        </TouchableOpacity>
      )}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16, gap: 12 }}>
          <Text style={styles.title}>Firma con il dito</Text>
          <View style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden' }}>
            <SignatureScreen ref={ref} onOK={onOK} onEmpty={() => Alert.alert('Firma vuota')} webStyle=".m-signature-pad--footer{display:none}" autoClear={false} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={() => ref.current?.readSignature()}>
              <Text style={styles.btnText}>Conferma</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnGhost} onPress={() => ref.current?.clearSignature()}>
              <Text style={styles.btnGhostText}>Cancella</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnGhost} onPress={() => setOpen(false)}>
              <Text style={styles.btnGhostText}>Chiudi</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

function GeoField({ value, readOnly, onChange }: { value: Geolocation | null; readOnly?: boolean; onChange: (v: Geolocation | null) => void }) {
  const [busy, setBusy] = useState(false)
  async function locate() {
    setBusy(true)
    try {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (!perm.granted) return Alert.alert('Permesso negato', 'Inserisci le coordinate a mano.')
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      onChange({ lat: round(pos.coords.latitude, 6), lng: round(pos.coords.longitude, 6), accuracy: round(pos.coords.accuracy ?? 0, 1) })
    } catch {
      Alert.alert('Posizione non disponibile', 'Riprova o inserisci le coordinate a mano.')
    } finally {
      setBusy(false)
    }
  }
  const setCoord = (k: 'lat' | 'lng', t: string) => {
    const n = t === '' ? null : Number(t.replace(',', '.'))
    const next = { lat: value?.lat ?? null, lng: value?.lng ?? null, [k]: Number.isFinite(n as number) ? n : null }
    onChange(next.lat === null && next.lng === null ? null : ({ lat: next.lat, lng: next.lng } as Geolocation))
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="Lat" keyboardType="numbers-and-punctuation" value={value?.lat != null ? String(value.lat) : ''} onChangeText={(t) => setCoord('lat', t)} editable={!readOnly} />
        <TextInput style={[styles.input, { flex: 1 }]} placeholder="Lng" keyboardType="numbers-and-punctuation" value={value?.lng != null ? String(value.lng) : ''} onChangeText={(t) => setCoord('lng', t)} editable={!readOnly} />
      </View>
      {!readOnly && (
        <TouchableOpacity style={[styles.btnGhost, { alignSelf: 'flex-start' }]} onPress={locate} disabled={busy}>
          <Text style={styles.btnGhostText}>{busy ? 'Ricerca…' : '📍 Posizione attuale'}</Text>
        </TouchableOpacity>
      )}
      {value?.accuracy !== undefined && <Text style={styles.muted}>precisione ±{value.accuracy} m</Text>}
    </View>
  )
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

const chip = StyleSheet.create({
  base: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  on: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { color: colors.text, fontWeight: '500' },
})
const photo = StyleSheet.create({
  thumb: { width: 96, height: 96, borderRadius: 6, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  remove: { position: 'absolute', top: 4, right: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(16,24,40,0.75)', alignItems: 'center', justifyContent: 'center' },
  signature: { width: '100%', height: 120, backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
})

