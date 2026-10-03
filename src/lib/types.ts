export type CueStatus = 'pending' | 'confirmed' | 'followup'
export type TabId = 'live' | 'backstage' | 'terms' | 'offline'
/** 记录来源：转写线路 / 口译位 / 未记来源的旧条目 */
export type CueSource = 'line' | 'interpreter' | 'legacy'

export interface Speaker {
  id: string
  name: string
  title: string
  language: string
  color: string
}

export interface Session {
  id: string
  order: number
  time: string
  title: string
  speakerId: string
  room: string
  status: 'upcoming' | 'live' | 'done'
}

export interface Term {
  id: string
  source: string
  target: string
  note: string
  speakerId: string
  priority: 'normal' | 'high'
}

export interface Announcement {
  id: string
  level: 'info' | 'warning' | 'urgent'
  text: string
  visibleOnStage: boolean
  createdAt: string
}

export interface Cue {
  id: string
  /** 线路下发的序号，线路侧与口译位同段共用同一序号 */
  sequence: number
  speakerId: string
  text: string
  /** 记录来源：线路 / 口译位 / 旧条目 */
  source: CueSource
  /** 旧条目打开时是否已补上来源标记 */
  sourceMarked: boolean
  receivedAt: number
  status: CueStatus
  manual: boolean
  offline: boolean
  delaySeconds: number
  duplicateOf: string | null
  followupText: string
  tags: string[]
  /** 该记录是否已挂到现场屏幕（线路侧上屏） */
  onScreen: boolean
  /** 收工前两边上屏段号是否已对账一致 */
  reconciled: boolean
  /** 对账对不上、留出等值班主管定 */
  heldForSupervisor: boolean
  /** 线路更正是否已回填（仅未确认段落） */
  lineCorrected: boolean
  /** 线路侧发送失败后按序号重试的次数 */
  retryCount: number
  /** 线路侧恢复失败、待按序号重试 */
  sendFailed: boolean
}

export interface Reminder {
  id: string
  termId: string
  cueId: string
  target: string
  createdAt: number
  acknowledged: boolean
}

export interface DeskState {
  speakers: Speaker[]
  sessions: Session[]
  terms: Term[]
  announcements: Announcement[]
  cues: Cue[]
  reminders: Reminder[]
  activeCueId: string
  fontScale: number
  online: boolean
  liveSimulation: boolean
  updatedAt: string
}
