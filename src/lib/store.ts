import { writable, get } from 'svelte/store'
import type { Announcement, Cue, CueSource, CueStatus, DeskState, Reminder, Session, Speaker, Term } from './types'

const STORAGE_KEY = 'conference-cue-desk-v1'
const speakers: Speaker[] = [
  { id: 'sp-1', name: 'Dr. Maya Chen', title: '首席气候科学家', language: '英语 → 中文', color: '#0f766e' },
  { id: 'sp-2', name: '刘启明', title: '城市韧性研究员', language: '中文 → 英语', color: '#b45309' },
  { id: 'sp-3', name: 'Prof. Daniel Ortiz', title: '公共卫生政策顾问', language: '西班牙语 → 中文', color: '#6d28d9' },
  { id: 'sp-4', name: '佐藤 美咲', title: '社区能源设计师', language: '日语 → 中文', color: '#be123c' }
]
const sessions: Session[] = [
  { id: 'se-1', order: 1, time: '09:00', title: '开幕式与议程说明', speakerId: 'sp-2', room: '主会场 A', status: 'done' },
  { id: 'se-2', order: 2, time: '09:20', title: '城市热岛与适应性基础设施', speakerId: 'sp-1', room: '主会场 A', status: 'live' },
  { id: 'se-3', order: 3, time: '10:05', title: '社区健康数据的地方行动', speakerId: 'sp-3', room: '主会场 A', status: 'upcoming' },
  { id: 'se-4', order: 4, time: '10:45', title: '分布式能源与社区共治', speakerId: 'sp-4', room: '主会场 A', status: 'upcoming' }
]
const terms: Term[] = [
  { id: 'term-1', source: 'urban heat island', target: '城市热岛', note: '首次出现完整译出，后可简称热岛', speakerId: 'sp-1', priority: 'high' },
  { id: 'term-2', source: 'resilience', target: '韧性', note: '不使用“恢复力”', speakerId: 'sp-1', priority: 'high' },
  { id: 'term-3', source: 'co-benefit', target: '协同效益', note: '环境与健康共同收益', speakerId: 'sp-1', priority: 'normal' },
  { id: 'term-4', source: 'distributed energy resource', target: '分布式能源资源', note: '缩写 DER', speakerId: 'sp-4', priority: 'high' },
  { id: 'term-5', source: 'health equity', target: '健康公平', note: '不译为健康平等', speakerId: 'sp-3', priority: 'high' }
]
function initialCues(): Cue[] {
  const now = Date.now()
  return [
    { id: 'cue-101', sequence: 1, speakerId: 'sp-1', text: 'The urban heat island effect is not evenly distributed across a city.', source: 'legacy', sourceMarked: true, receivedAt: now - 36000, status: 'confirmed', manual: false, offline: false, delaySeconds: 4, duplicateOf: null, followupText: '', tags: ['城市热岛'], onScreen: true, reconciled: false, heldForSupervisor: false, lineCorrected: false, retryCount: 0, sendFailed: false },
    { id: 'cue-102', sequence: 2, speakerId: 'sp-1', text: 'Neighborhoods with less tree canopy can be several degrees warmer at night.', source: 'legacy', sourceMarked: true, receivedAt: now - 19000, status: 'confirmed', manual: false, offline: false, delaySeconds: 6, duplicateOf: null, followupText: '补译：“夜间温差可达数摄氏度。”', tags: ['树冠覆盖率'], onScreen: true, reconciled: false, heldForSupervisor: false, lineCorrected: false, retryCount: 0, sendFailed: false },
    { id: 'cue-103', sequence: 3, speakerId: 'sp-1', text: 'Our resilience strategy links cooling corridors with public health investments.', source: 'legacy', sourceMarked: true, receivedAt: now - 9000, status: 'pending', manual: false, offline: false, delaySeconds: 11, duplicateOf: null, followupText: '', tags: ['韧性', '协同效益'], onScreen: false, reconciled: false, heldForSupervisor: false, lineCorrected: false, retryCount: 0, sendFailed: false },
    { id: 'cue-104', sequence: 4, speakerId: 'sp-1', text: 'That data also reveals health equity gaps between districts.', source: 'legacy', sourceMarked: true, receivedAt: now - 2500, status: 'pending', manual: false, offline: false, delaySeconds: 4, duplicateOf: null, followupText: '', tags: ['健康公平'], onScreen: false, reconciled: false, heldForSupervisor: false, lineCorrected: false, retryCount: 0, sendFailed: false }
  ]
}
function demoState(): DeskState {
  return {
    speakers, sessions, terms, cues: initialCues(), reminders: [], activeCueId: 'cue-103', fontScale: 100,
    announcements: [
      { id: 'ann-1', level: 'info', text: '十点整有消防联动测试，请提醒会场人员保持镇定。', visibleOnStage: false, createdAt: new Date().toISOString() },
      { id: 'ann-2', level: 'urgent', text: '请下一位发言人提前到侧台候场。', visibleOnStage: false, createdAt: new Date().toISOString() }
    ],
    online: true, liveSimulation: true, updatedAt: new Date().toISOString()
  }
}
function clone<T>(value: T): T { return structuredClone(value) }
function nextSequence(state: DeskState): number {
  return state.cues.reduce((max, cue) => Math.max(max, cue.sequence), 0) + 1
}
/** 旧条目没记来源的，打开时补上标记再启用 */
function markLegacyCues(state: DeskState) {
  state.cues.forEach(cue => {
    if (!cue.source) {
      cue.source = 'legacy'
      cue.sourceMarked = true
    }
  })
}
function loadState(): DeskState {
  if (typeof localStorage === 'undefined') return demoState()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const loaded: DeskState = saved ? { ...demoState(), ...JSON.parse(saved), online: navigator.onLine } : demoState()
    markLegacyCues(loaded)
    return loaded
  } catch { return demoState() }
}
const history: DeskState[] = []
const future: DeskState[] = []
export const desk = writable<DeskState>(loadState())

function persist(state: DeskState) {
  state.updatedAt = new Date().toISOString()
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}
function commit(recipe: (state: DeskState) => void) {
  const current = clone(get(desk))
  const next = clone(current)
  recipe(next)
  history.push(current)
  if (history.length > 60) history.shift()
  future.length = 0
  persist(next)
  desk.set(next)
}
export function undoDesk() {
  const previous = history.pop()
  if (!previous) return
  future.push(clone(get(desk)))
  desk.set(previous); persist(previous)
}
export function redoDesk() {
  const next = future.pop()
  if (!next) return
  history.push(clone(get(desk)))
  desk.set(next); persist(next)
}
export const canUndo = () => history.length > 0
export const canRedo = () => future.length > 0

export function addSpeaker() {
  commit(state => state.speakers.push({ id: `sp-${Date.now()}`, name: '新发言人', title: '待填写机构与职务', language: '待设置语言方向', color: '#475569' }))
}
export function updateSpeaker(id: string, patch: Partial<Speaker>) { commit(state => { const item = state.speakers.find(row => row.id === id); if (item) Object.assign(item, patch) }) }
export function addSession() {
  commit(state => state.sessions.push({ id: `se-${Date.now()}`, order: Math.max(0, ...state.sessions.map(item => item.order)) + 1, time: '11:30', title: '新演讲', speakerId: state.speakers[0]?.id || '', room: '主会场 A', status: 'upcoming' }))
}
export function updateSession(id: string, patch: Partial<Session>) { commit(state => { const item = state.sessions.find(row => row.id === id); if (item) Object.assign(item, patch) }) }
export function addTerm() { commit(state => state.terms.push({ id: `term-${Date.now()}`, source: 'new term', target: '新术语', note: '', speakerId: state.speakers[0]?.id || '', priority: 'normal' })) }
export function updateTerm(id: string, patch: Partial<Term>) { commit(state => { const item = state.terms.find(row => row.id === id); if (item) Object.assign(item, patch) }) }
export function addAnnouncement(text: string, level: Announcement['level']) {
  if (!text.trim()) return
  commit(state => state.announcements.unshift({ id: `ann-${Date.now()}`, level, text: text.trim(), visibleOnStage: false, createdAt: new Date().toISOString() }))
}
export function publishAnnouncement(id: string, visible: boolean) { commit(state => { const item = state.announcements.find(row => row.id === id); if (item) item.visibleOnStage = visible }) }

export function setOnline(online: boolean) {
  commit(state => {
    state.online = online
    if (online) {
      // 恢复后按序号补送：只动线路侧，口译位那份不受影响
      state.cues
        .filter(cue => cue.source === 'line' && cue.offline)
        .sort((a, b) => a.sequence - b.sequence)
        .forEach(cue => {
          cue.offline = false
          cue.sendFailed = false
          const duplicate = findDuplicate(cue.text, state.cues.filter(item => item.id !== cue.id && !item.offline))
          cue.duplicateOf = duplicate?.id || null
        })
    }
  })
}
export function setLiveSimulation(enabled: boolean) { commit(state => { state.liveSimulation = enabled }) }
export function setActiveCue(id: string) { commit(state => { state.activeCueId = id }) }
export function moveCue(direction: 1 | -1) {
  const state = get(desk)
  const index = state.cues.findIndex(item => item.id === state.activeCueId)
  const next = state.cues[index + direction]
  if (next) setActiveCue(next.id)
}
export function setFontScale(scale: number) { commit(state => { state.fontScale = Math.min(150, Math.max(85, scale)) }) }

export function ingestCue(text: string, options: { manual?: boolean; speakerId?: string; receivedAt?: number; source?: CueSource; sequence?: number } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return
  commit(state => {
    const source: CueSource = options.source || (options.manual ? 'interpreter' : 'line')
    const sequence = options.sequence || nextSequence(state)
    // 线路更正只回填还没确认的段落，确认过的照旧
    if (source === 'line') {
      const existing = state.cues.find(item => item.source === 'line' && item.sequence === sequence)
      if (existing) {
        if (existing.status === 'confirmed') return
        existing.text = trimmed
        existing.lineCorrected = true
        existing.tags = detectTerms(trimmed, state.terms)
        return
      }
    }
    const existing = state.cues.filter(item => item.text !== trimmed)
    const duplicate = findDuplicate(trimmed, existing)
    const speakerId = options.speakerId || state.sessions.find(item => item.status === 'live')?.speakerId || state.speakers[0]?.id || ''
    const receivedAt = options.receivedAt || Date.now()
    const cue: Cue = {
      id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, sequence, speakerId, text: trimmed, source, sourceMarked: true, receivedAt,
      status: 'pending', manual: Boolean(options.manual), offline: !state.online, delaySeconds: Math.max(0, Math.round((Date.now() - receivedAt) / 1000)),
      duplicateOf: duplicate?.id || null, followupText: '', tags: detectTerms(trimmed, state.terms),
      onScreen: false, reconciled: false, heldForSupervisor: false, lineCorrected: false, retryCount: 0, sendFailed: false
    }
    state.cues.push(cue); state.activeCueId = cue.id
  })
}
export function updateCue(id: string, patch: Partial<Cue>) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) Object.assign(cue, patch) }) }
export function setCueStatus(id: string, status: CueStatus) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (!cue) return
    cue.status = status
    if (status === 'confirmed') cue.onScreen = true
  })
}
export function deleteCue(id: string) { commit(state => { state.cues = state.cues.filter(item => item.id !== id); if (state.activeCueId === id) state.activeCueId = state.cues.at(-1)?.id || '' }) }

/** 线路侧手动挂/撤已上屏段号（仅线路记录参与上屏对账） */
export function toggleLineScreen(id: string) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (cue && cue.source === 'line') cue.onScreen = !cue.onScreen
  })
}

/**
 * 收工前对账：线路侧与口译位挂的已上屏段号按序号比对。
 * 对不上的留出等值班主管定，一致的标记已对账。
 * 旧条目不参与两边对账。
 */
export function reconcileScreen() {
  commit(state => {
    const lineSeqs = new Set<number>()
    const interpSeqs = new Set<number>()
    state.cues.forEach(cue => {
      if (cue.source === 'line' && cue.onScreen) lineSeqs.add(cue.sequence)
      if (cue.source !== 'legacy' && cue.onScreen && cue.status === 'confirmed') interpSeqs.add(cue.sequence)
    })
    const all = new Set<number>([...lineSeqs, ...interpSeqs])
    state.cues.forEach(cue => {
      if (cue.source === 'legacy') return
      if (!all.has(cue.sequence)) return
      const mismatch = lineSeqs.has(cue.sequence) !== interpSeqs.has(cue.sequence)
      cue.heldForSupervisor = mismatch
      cue.reconciled = !mismatch
    })
  })
}

/** 线路侧恢复失败后按序号重试；口译位那份不受影响 */
export function retryLineSend() {
  commit(state => {
    state.cues
      .filter(cue => cue.source === 'line' && cue.sendFailed)
      .sort((a, b) => a.sequence - b.sequence)
      .forEach(cue => {
        cue.retryCount += 1
        cue.sendFailed = false
        cue.onScreen = true
      })
  })
}

/** 模拟线路侧发送失败（按序号），供演示重试 */
export function markLineSendFailed(id: string) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (cue && cue.source === 'line') { cue.sendFailed = true; cue.onScreen = false }
  })
}

/**
 * 线路更正：只回填还没确认的段落，确认过的照旧。
 * 返回 'backfilled' | 'skipped' | 'notfound' 供界面提示。
 */
export function applyLineCorrection(sequence: number, text: string): 'backfilled' | 'skipped' | 'notfound' {
  let result: 'backfilled' | 'skipped' | 'notfound' = 'notfound'
  commit(state => {
    const cue = state.cues.find(item => item.source === 'line' && item.sequence === sequence)
    if (!cue) { result = 'notfound'; return }
    if (cue.status === 'confirmed') { result = 'skipped'; return }
    cue.text = text.trim()
    cue.lineCorrected = true
    cue.tags = detectTerms(cue.text, state.terms)
    result = 'backfilled'
  })
  return result
}
export function clearDuplicate(id: string) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) cue.duplicateOf = null }) }
export function sendReminder(termId: string, cueId: string) {
  commit(state => {
    const exists = state.reminders.some(item => item.termId === termId && item.cueId === cueId)
    if (exists) return
    state.reminders.unshift({ id: `rem-${Date.now()}`, termId, cueId, target: state.terms.find(item => item.id === termId)?.target || '', createdAt: Date.now(), acknowledged: false })
  })
}
export function acknowledgeReminder(id: string) { commit(state => { const item = state.reminders.find(row => row.id === id); if (item) item.acknowledged = true }) }

export function getDelay(cue: Cue, now = Date.now()): number { return Math.max(cue.delaySeconds, Math.round((now - cue.receivedAt) / 1000)) }
export function speakerName(state: DeskState, id: string): string { return state.speakers.find(item => item.id === id)?.name || '未指定' }
export function termTarget(state: DeskState, id: string): string { return state.terms.find(item => item.id === id)?.target || '' }
function detectTerms(text: string, terms: Term[]): string[] {
  const lower = text.toLowerCase()
  return terms.filter(term => lower.includes(term.source.toLowerCase()) || lower.includes(term.target)).map(term => term.target)
}
function findDuplicate(text: string, cues: Cue[]): Cue | undefined {
  return cues.find(cue => similarity(text, cue.text) >= 0.72)
}
function similarity(a: string, b: string): number {
  const grams = (value: string) => {
    const clean = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
    return new Set(Array.from({ length: Math.max(0, clean.length - 1) }, (_, index) => clean.slice(index, index + 2)))
  }
  const left = grams(a), right = grams(b)
  if (!left.size || !right.size) return a.trim() === b.trim() ? 1 : 0
  let intersection = 0
  left.forEach(item => { if (right.has(item)) intersection++ })
  return intersection / (left.size + right.size - intersection)
}
