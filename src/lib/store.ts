import { writable, get } from 'svelte/store'
import type {
  Announcement, Cue, CueStatus, CueSource, DeliveryState, DeskState,
  ReconcileState, Reminder, Session, Speaker, Term
} from './types'

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

interface SeedCue {
  seq: number
  text: string
  ago: number
  status: CueStatus
  delay: number
  followup?: string
  tags: string[]
  lineOnScreen: boolean
  deskOnScreen: boolean
  reconcile?: ReconcileState
}
const seedCues: SeedCue[] = [
  { seq: 101, text: 'The urban heat island effect is not evenly distributed across a city.', ago: 36000, status: 'confirmed', delay: 4, tags: ['城市热岛'], lineOnScreen: true, deskOnScreen: true },
  { seq: 102, text: 'Neighborhoods with less tree canopy can be several degrees warmer at night.', ago: 19000, status: 'confirmed', delay: 6, followup: '补译：“夜间温差可达数摄氏度。”', tags: ['树冠覆盖率'], lineOnScreen: true, deskOnScreen: false, reconcile: 'held' },
  { seq: 103, text: 'Our resilience strategy links cooling corridors with public health investments.', ago: 9000, status: 'pending', delay: 11, tags: ['韧性', '协同效益'], lineOnScreen: false, deskOnScreen: false },
  { seq: 104, text: 'That data also reveals health equity gaps between districts.', ago: 2500, status: 'pending', delay: 4, tags: ['健康公平'], lineOnScreen: false, deskOnScreen: false }
]

function initialCues(): Cue[] {
  const now = Date.now()
  return seedCues.map(row => ({
    id: `cue-${row.seq}`,
    seq: row.seq,
    source: 'line' as CueSource,
    enabled: true,
    legacy: false,
    speakerId: 'sp-1',
    text: row.text,
    receivedAt: now - row.ago,
    status: row.status,
    manual: false,
    offline: false,
    delivery: 'live' as DeliveryState,
    delaySeconds: row.delay,
    duplicateOf: null,
    followupText: row.followup || '',
    tags: row.tags,
    corrected: false,
    lineOnScreen: row.lineOnScreen,
    deskOnScreen: row.deskOnScreen,
    reconcile: row.reconcile || 'none',
    resolveNote: '',
    retryCount: 0
  }))
}

function demoState(): DeskState {
  return {
    speakers, sessions, terms, cues: initialCues(), reminders: [], activeCueId: 'cue-103', fontScale: 100,
    announcements: [
      { id: 'ann-1', level: 'info', text: '十点整有消防联动测试，请提醒会场人员保持镇定。', visibleOnStage: false, createdAt: new Date().toISOString() },
      { id: 'ann-2', level: 'urgent', text: '请下一位发言人提前到侧台候场。', visibleOnStage: false, createdAt: new Date().toISOString() }
    ],
    online: true, lineConnected: true, lineRecoveryFailed: false,
    liveSimulation: true, nextSeq: 105, legacyImported: 0,
    updatedAt: new Date().toISOString()
  }
}

function clone<T>(value: T): T { return structuredClone(value) }

/**
 * 旧条目没记来源的，打开时补上来源标记再启用。
 * 老版本存储里没有 seq/source/双份上屏等字段，这里统一补齐。
 */
function migrate(state: DeskState): DeskState {
  let legacyImported = 0
  let maxSeq = 100
  state.cues.forEach(cue => {
    if (cue.seq === undefined || cue.source === undefined) {
      cue.legacy = true
      legacyImported++
    }
    if (cue.source === undefined) cue.source = 'line'
    if (cue.enabled === undefined) cue.enabled = true
    if (cue.legacy === undefined) cue.legacy = false
    if (cue.delivery === undefined) cue.delivery = cue.offline ? 'deskQueued' : 'live'
    if (cue.corrected === undefined) cue.corrected = false
    if (cue.lineOnScreen === undefined) cue.lineOnScreen = cue.status === 'confirmed'
    if (cue.deskOnScreen === undefined) cue.deskOnScreen = cue.status === 'confirmed'
    if (cue.reconcile === undefined) cue.reconcile = 'none'
    if (cue.resolveNote === undefined) cue.resolveNote = ''
    if (cue.retryCount === undefined) cue.retryCount = 0
    if (typeof cue.seq !== 'number') cue.seq = ++maxSeq
    maxSeq = Math.max(maxSeq, cue.seq)
  })
  if (state.nextSeq === undefined) state.nextSeq = maxSeq + 1
  if (state.lineConnected === undefined) state.lineConnected = true
  if (state.lineRecoveryFailed === undefined) state.lineRecoveryFailed = false
  if (state.legacyImported === undefined) state.legacyImported = legacyImported
  else if (legacyImported) state.legacyImported += legacyImported
  return state
}

function loadState(): DeskState {
  if (typeof localStorage === 'undefined') return demoState()
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return demoState()
    const merged = { ...demoState(), ...JSON.parse(saved), online: navigator.onLine }
    return migrate(merged)
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

/* ---------------- 网络：口译位与转写线路各走各的 ---------------- */

/** 口译位侧网络（浏览器 online/offline 事件也走这里） */
export function setOnline(online: boolean) {
  commit(state => { state.online = online })
}

/** 转写线路断连：线路的账开始排队，口译位那份不受影响 */
export function setLineDisconnected() {
  commit(state => {
    state.lineConnected = false
    state.lineRecoveryFailed = false
  })
}

/**
 * 转写线路恢复：恢复成功，线路待重试条目按序号顺序补送；
 * 恢复失败则标记失败、保持待重试，口译位记录完全不动。
 */
export function recoverLine(success: boolean) {
  commit(state => {
    if (success) {
      state.lineConnected = true
      state.lineRecoveryFailed = false
      state.cues
        .filter(cue => cue.delivery === 'lineQueued' || cue.delivery === 'lineRetry')
        .sort((a, b) => a.seq - b.seq)
        .forEach(cue => {
          cue.delivery = 'live'
          cue.retryCount = 0
        })
    } else {
      state.lineConnected = false
      state.lineRecoveryFailed = true
      state.cues
        .filter(cue => cue.delivery === 'lineQueued')
        .sort((a, b) => a.seq - b.seq)
        .forEach(cue => { cue.delivery = 'lineRetry' })
    }
  })
}

/** 线路侧“恢复失败后按序号重试”：只动线路那份，逐条重试，仍失败则保留 */
export function retryLineBySeq(perTrySucceeds: boolean): { done: number; remaining: number } {
  let done = 0, remaining = 0
  commit(state => {
    const queued = state.cues
      .filter(cue => cue.delivery === 'lineRetry' || cue.delivery === 'lineQueued')
      .sort((a, b) => a.seq - b.seq)
    queued.forEach(cue => {
      cue.retryCount += 1
      if (perTrySucceeds) {
        cue.delivery = 'live'
        cue.retryCount = 0
        done++
      } else {
        cue.delivery = 'lineRetry'
        remaining++
      }
    })
  })
  return { done, remaining }
}

/**
 * 口译位网络恢复：照旧记下的内容按序号补送，合并时重新做重复检查。
 * 不影响线路侧任何状态。
 */
export function recoverDesk(): { resent: number } {
  let resent = 0
  commit(state => {
    state.online = true
    state.cues
      .filter(cue => cue.delivery === 'deskQueued')
      .sort((a, b) => a.seq - b.seq)
      .forEach(cue => {
        const duplicate = findDuplicate(cue.text, state.cues.filter(item => item.id !== cue.id && item.delivery === 'live'))
        cue.duplicateOf = duplicate?.id || null
        cue.offline = false
        cue.delivery = 'live'
        resent++
      })
  })
  return { resent }
}

export function dismissLegacyNotice() { commit(state => { state.legacyImported = 0 }) }

export function setLiveSimulation(enabled: boolean) { commit(state => { state.liveSimulation = enabled }) }
export function setActiveCue(id: string) { commit(state => { state.activeCueId = id }) }
export function moveCue(direction: 1 | -1) {
  const state = get(desk)
  const visible = state.cues.filter(item => item.enabled)
  const index = visible.findIndex(item => item.id === state.activeCueId)
  const next = visible[index + direction]
  if (next) setActiveCue(next.id)
}
export function setFontScale(scale: number) { commit(state => { state.fontScale = Math.min(150, Math.max(85, scale)) }) }

/**
 * 记账：
 * - source 'line'：转写线路推送，带推送序号和原话；线路断连时排队/待重试。
 * - source 'desk'：口译位手工录入；口译位断网时本机照记，恢复后按序号补送。
 */
export function ingestCue(text: string, options: { manual?: boolean; speakerId?: string; receivedAt?: number; source?: CueSource } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return
  commit(state => {
    const source: CueSource = options.source || 'line'
    const existing = state.cues.filter(item => item.enabled && item.text !== trimmed && item.delivery === 'live')
    const duplicate = findDuplicate(trimmed, existing)
    const speakerId = options.speakerId || state.sessions.find(item => item.status === 'live')?.speakerId || state.speakers[0]?.id || ''
    const receivedAt = options.receivedAt || Date.now()
    const seq = state.nextSeq++
    let delivery: DeliveryState = 'live'
    if (source === 'desk' && !state.online) delivery = 'deskQueued'
    if (source === 'line' && !state.lineConnected) delivery = state.lineRecoveryFailed ? 'lineRetry' : 'lineQueued'
    const cue: Cue = {
      id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      seq, source, enabled: true, legacy: false,
      speakerId, text: trimmed, receivedAt,
      status: 'pending', manual: source === 'desk' || Boolean(options.manual),
      offline: source === 'desk' && !state.online,
      delivery,
      delaySeconds: Math.max(0, Math.round((Date.now() - receivedAt) / 1000)),
      duplicateOf: duplicate?.id || null, followupText: '', tags: detectTerms(trimmed, state.terms),
      corrected: false,
      // 初进队列两边都还没上屏；确认的口译位侧才挂自己的上屏号
      lineOnScreen: false, deskOnScreen: false,
      reconcile: 'none', resolveNote: '', retryCount: 0
    }
    state.cues.push(cue); state.activeCueId = cue.id
  })
}

export function updateCue(id: string, patch: Partial<Cue>) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) Object.assign(cue, patch) }) }

/**
 * 口译位确认：口译位侧管确认结果，并把该段号挂到口译位的“已上屏”账上。
 * 确认过的段不再被线路更正回填。
 */
export function setCueStatus(id: string, status: CueStatus) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (!cue) return
    cue.status = status
    if (status === 'confirmed') cue.deskOnScreen = true
  })
}
export function deleteCue(id: string) {
  commit(state => {
    state.cues = state.cues.filter(item => item.id !== id)
    if (state.activeCueId === id) state.activeCueId = state.cues.filter(item => item.enabled).at(-1)?.id || ''
  })
}
export function clearDuplicate(id: string) { commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) cue.duplicateOf = null }) }

/**
 * 线路更正：只回填还没确认的段落；已确认的照旧不动。
 * 更正只改线路那份的原话，口译位的确认结果、补译、上屏标记都不受影响。
 */
export function correctCue(id: string, text: string): boolean {
  let applied = false
  const trimmed = text.trim()
  if (!trimmed) return false
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (!cue || cue.status === 'confirmed') return
    cue.text = trimmed
    cue.corrected = true
    cue.tags = detectTerms(trimmed, state.terms)
    const duplicate = findDuplicate(trimmed, state.cues.filter(item => item.id !== id && item.enabled && item.delivery === 'live'))
    cue.duplicateOf = duplicate?.id || null
    applied = true
  })
  return applied
}

/** 线路侧挂/摘自己的已上屏段号；对账结论作废后重新回到未对账 */
export function toggleLineOnScreen(id: string) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (!cue) return
    cue.lineOnScreen = !cue.lineOnScreen
    cue.reconcile = 'none'
    cue.resolveNote = ''
  })
}
/** 口译位侧挂/摘自己的已上屏段号 */
export function toggleDeskOnScreen(id: string) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (!cue) return
    cue.deskOnScreen = !cue.deskOnScreen
    cue.reconcile = 'none'
    cue.resolveNote = ''
  })
}

/** 旧条目（或任意条目）启用/停用切换 */
export function setCueEnabled(id: string, enabled: boolean) {
  commit(state => { const cue = state.cues.find(item => item.id === id); if (cue) cue.enabled = enabled })
}

/* ---------------- 收工对账 ---------------- */

export interface ReconcileResult {
  matched: Cue[]
  mismatched: Cue[]
}

/**
 * 两边挂的已上屏段号收工前对账：
 * 两边一致（都挂或都没挂）= 对得上；不一致的先留出（挂起），等值班主管定。
 */
export function reconcileOnScreen(): ReconcileResult {
  const matched: Cue[] = []
  const mismatched: Cue[] = []
  commit(state => {
    state.cues
      .filter(cue => cue.enabled)
      .sort((a, b) => a.seq - b.seq)
      .forEach(cue => {
        if (cue.reconcile === 'resolvedLine' || cue.reconcile === 'resolvedDesk') {
          matched.push(cue)
          return
        }
        if (cue.lineOnScreen !== cue.deskOnScreen) {
          cue.reconcile = 'held'
          cue.status = 'quarantined'
          mismatched.push(cue)
        } else {
          if (cue.reconcile === 'held') cue.reconcile = 'none'
          if (cue.status === 'quarantined' && cue.lineOnScreen && cue.deskOnScreen) cue.status = 'confirmed'
          matched.push(cue)
        }
      })
  })
  return { matched, mismatched }
}

/** 值班主管定夺：以转写线路或口译位那份为准，统一两边的已上屏段号 */
export function resolveReconcile(id: string, winner: 'line' | 'desk', note: string) {
  commit(state => {
    const cue = state.cues.find(item => item.id === id)
    if (!cue) return
    const onScreen = winner === 'line' ? cue.lineOnScreen : cue.deskOnScreen
    cue.lineOnScreen = onScreen
    cue.deskOnScreen = onScreen
    cue.reconcile = winner === 'line' ? 'resolvedLine' : 'resolvedDesk'
    cue.resolveNote = note.trim()
    cue.status = onScreen ? 'confirmed' : 'pending'
  })
}

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
