import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { defaults, validateSubmission, type FieldError, type FormData, type FormSchema } from '@fieldview/form-core'
import { isNull } from 'drizzle-orm'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { useAuth } from '../auth/AuthContext'
import { loadDraft, saveDraft, saveSubmissionLocally } from '../data/submissions'
import { useDb } from '../db/DbContext'
import { schema, type AppDb } from '../db/types'
import DynamicForm, { type LocalAttachments } from '../forms/DynamicForm'
import type { RootStackParamList } from '../navigation'
import { colors, styles } from '../ui'

type Props = NativeStackScreenProps<RootStackParamList, 'Submission'>

/** Scelta del template (se non fissato) → DynamicForm → salva in locale. Bozza autosalvata a ogni modifica. */
export default function SubmissionScreen({ route, navigation }: Props) {
  const db = useDb()
  const { user } = useAuth()
  const { pinId } = route.params
  const templates = useMemo(() => db.select().from(schema.formTemplates).where(isNull(schema.formTemplates.archived_at)).orderBy(schema.formTemplates.name).all(), [db])
  const [templateId, setTemplateId] = useState<string | null>(route.params.templateId ?? (templates.length === 1 ? templates[0].id : null))
  const template = templates.find((t) => t.id === templateId)

  useEffect(() => {
    navigation.setOptions({ title: template ? template.name : 'Compila modulo' })
  }, [navigation, template])

  if (!template) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.h2}>Quale modulo?</Text>
        {templates.map((t) => (
          <TouchableOpacity key={t.id} style={styles.card} onPress={() => setTemplateId(t.id)}>
            <Text style={styles.h2}>{t.name}</Text>
            {loadDraft(db, pinId, t.id) && <Text style={{ color: colors.warn, fontSize: 13 }}>Bozza salvata</Text>}
          </TouchableOpacity>
        ))}
        {templates.length === 0 && <Text style={styles.muted}>Nessun template: sincronizza prima.</Text>}
      </ScrollView>
    )
  }
  return <Editor key={template.id} db={db} pinId={pinId} templateId={template.id} schema={template.schema_def as unknown as FormSchema} userId={user?.id ?? null} onDone={() => navigation.goBack()} />
}

function Editor({ db, pinId, templateId, schema: formSchema, userId, onDone }: { db: AppDb; pinId: string; templateId: string; schema: FormSchema; userId: string | null; onDone: () => void }) {
  const draft = useMemo(() => loadDraft(db, pinId, templateId), [db, pinId, templateId])
  const [value, setValue] = useState<FormData>(() => (draft ? { ...defaults(formSchema), ...(draft.data_json as FormData) } : defaults(formSchema)))
  const [attachments, setAttachments] = useState<LocalAttachments>(() => (draft?.attachments_json as LocalAttachments) ?? {})
  const [touched, setTouched] = useState(false)
  const dirtyRef = useRef(false)

  // autosave bozza (debounce leggero)
  useEffect(() => {
    if (!dirtyRef.current) return
    const t = setTimeout(() => saveDraft(db, pinId, templateId, value, attachments), 400)
    return () => clearTimeout(t)
  }, [db, pinId, templateId, value, attachments])

  const errors = useMemo<FieldError[]>(() => (touched ? validateSubmission(formSchema, value) : []), [touched, formSchema, value])

  function save() {
    setTouched(true)
    const errs = validateSubmission(formSchema, value)
    if (errs.length) return Alert.alert('Modulo incompleto', `${errs.length} ${errs.length === 1 ? 'campo da correggere' : 'campi da correggere'}.`)
    saveSubmissionLocally(db, { pinId, templateId, data: value, attachments, userId })
    Alert.alert('Modulo salvato', 'Verrà inviato alla prossima sincronizzazione.', [{ text: 'OK', onPress: onDone }])
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 40 }]} keyboardShouldPersistTaps="handled">
        {draft && <Text style={{ color: colors.warn, fontSize: 13 }}>Bozza ripristinata ({draft.updated_at.slice(0, 16).replace('T', ' ')}).</Text>}
        <DynamicForm
          schema={formSchema}
          value={value}
          errors={errors}
          attachments={attachments}
          onChange={(v) => {
            dirtyRef.current = true
            setValue(v)
          }}
          onAttachmentsChange={(a) => {
            dirtyRef.current = true
            setAttachments(a)
          }}
        />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TouchableOpacity style={[styles.btn, { flex: 1 }]} onPress={save}>
            <Text style={styles.btnText}>Salva modulo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnGhost} onPress={onDone}>
            <Text style={styles.btnGhostText}>Annulla</Text>
          </TouchableOpacity>
        </View>
        {touched && errors.length > 0 && <Text style={styles.error}>{errors.length} da correggere</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
