import { useEffect, useMemo, useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import type { PinLevel, PinWithCounts } from '../data/catalog'
import { pinLevel } from '../data/catalog'
import type { Plan } from '../db/schema'
import { colors } from '../ui'

export const PIN_COLOR: Record<PinLevel, string> = {
  open: colors.danger,
  assigned: colors.warn,
  resolved: colors.ok,
  verified: colors.muted,
  submission: colors.primary,
  empty: '#b8c0c9',
}

type Props = {
  plan: Plan
  pins: PinWithCounts[]
  selectedId?: string | null
  /** sorgente immagine: file locale (offline) o URL remoto con header */
  source: { uri: string; headers?: Record<string, string> }
  onSelectPin: (pin: PinWithCounts) => void
  /** long-press sulla planimetria: coordinate relative 0-1 */
  onLongPress?: (x: number, y: number) => void
}

const MIN_SCALE = 0.5
const MAX_SCALE = 8
const PIN_W = 28
const PIN_H = 37

/**
 * Planimetria con pinch/pan (gesture-handler + reanimated) e pin in coordinate
 * relative. L'immagine è resa a "fit" nel contenitore; scale/translate sono
 * shared value sul thread UI, i pin sono figli dello stesso Animated.View e si
 * riscalano di 1/scale per restare della stessa dimensione a schermo.
 */
export default function PlanViewer({ plan, pins, selectedId, source, onSelectPin, onLongPress }: Props) {
  const [box, setBox] = useState({ w: 0, h: 0 })
  const imgW = plan.width_px ?? 1
  const imgH = plan.height_px ?? 1
  // dimensione a "fit" (scale = 1)
  const fit = useMemo(() => {
    if (!box.w || !box.h) return { w: 0, h: 0 }
    const s = Math.min(box.w / imgW, box.h / imgH) * 0.96
    return { w: imgW * s, h: imgH * s }
  }, [box, imgW, imgH])

  const scale = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const startScale = useSharedValue(1)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  useEffect(() => {
    // nuova planimetria: reset
    scale.value = 1
    tx.value = 0
    ty.value = 0
  }, [plan.id, scale, tx, ty])

  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.value = scale.value
    })
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale))
    })
  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onStart(() => {
      startX.value = tx.value
      startY.value = ty.value
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX
      ty.value = startY.value + e.translationY
    })
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      // doppio tap: torna al fit o zoom 2x
      if (scale.value > 1.05) {
        scale.value = 1
        tx.value = 0
        ty.value = 0
      } else {
        scale.value = 2
      }
    })
  const longPress = Gesture.LongPress()
    .minDuration(450)
    .onStart((e) => {
      if (!onLongPress || !fit.w) return
      // e.x/e.y sono nel sistema del contenitore; l'immagine è centrata e trasformata attorno al centro
      const cx = box.w / 2 + tx.value
      const cy = box.h / 2 + ty.value
      const rx = (e.x - cx) / (fit.w * scale.value) + 0.5
      const ry = (e.y - cy) / (fit.h * scale.value) + 0.5
      if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return
      runOnJS(onLongPress)(rx, ry)
    })
  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, longPress))

  const canvasStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }))
  const markerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -PIN_W / 2 }, { translateY: -PIN_H }, { scale: 1 / scale.value }] }))

  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.container} onLayout={onLayout} collapsable={false}>
        {fit.w > 0 && (
          <Animated.View style={[styles.canvas, { width: fit.w, height: fit.h, marginLeft: -fit.w / 2, marginTop: -fit.h / 2 }, canvasStyle]}>
            <Image source={source} style={{ width: fit.w, height: fit.h }} resizeMode="stretch" />
            {pins.map((p) => (
              <Animated.View key={p.id} style={[styles.pin, { left: p.x * fit.w, top: p.y * fit.h, transformOrigin: '50% 100%' }, markerStyle]}>
                <Pressable onPress={() => onSelectPin(p)} accessibilityRole="button" accessibilityLabel={p.label ?? 'Pin'} hitSlop={6}>
                  <PinMarker level={pinLevel(p)} selected={p.id === selectedId} count={p.tasks_open + p.tasks_assigned + p.tasks_resolved + p.tasks_verified} />
                </Pressable>
              </Animated.View>
            ))}
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  )
}

/** Goccia colorata con la punta sul punto: stessa forma del marker web. */
export function PinMarker({ level, selected, count }: { level: PinLevel; selected?: boolean; count?: number }) {
  const color = PIN_COLOR[level]
  return (
    <View style={{ width: PIN_W, height: PIN_H, alignItems: 'center' }}>
      <View style={[styles.head, { backgroundColor: color, borderColor: selected ? colors.text : '#fff', borderWidth: selected ? 2.5 : 1.5 }]}>
        <View style={styles.dot} />
      </View>
      <View style={[styles.tail, { borderTopColor: color }]} />
      {!!count && count > 1 && (
        <View style={styles.count}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, overflow: 'hidden', backgroundColor: '#e9ecef' },
  canvas: { position: 'absolute', left: '50%', top: '50%', backgroundColor: '#fff' },
  pin: { position: 'absolute', width: PIN_W, height: PIN_H },
  head: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#fff' },
  tail: { width: 0, height: 0, borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -3 },
  count: { position: 'absolute', top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.text, borderWidth: 1.5, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
})
