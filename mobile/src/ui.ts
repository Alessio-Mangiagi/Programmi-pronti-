import { StyleSheet } from 'react-native'

// Palette allineata al web (web/src/index.css).
export const colors = {
  bg: '#f4f5f7',
  surface: '#ffffff',
  border: '#dfe3e8',
  text: '#1c2430',
  muted: '#6b7684',
  primary: '#1f5f8b',
  accent: '#f5a524',
  danger: '#c0392b',
  ok: '#2e8b57',
  warn: '#d68910',
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: 14 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  h2: { fontSize: 16, fontWeight: '600', color: colors.text },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13 },
  label: { color: colors.muted, fontSize: 13, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: colors.surface, fontSize: 16, color: colors.text },
  btn: { backgroundColor: colors.primary, padding: 14, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  btnGhost: { padding: 12, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  btnGhostText: { color: colors.text, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, fontSize: 12, fontWeight: '600', overflow: 'hidden' },
  empty: { padding: 32, alignItems: 'center' },
})
