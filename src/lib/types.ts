export type CueStatus = 'pending' | 'confirmed' | 'followup' | 'quarantined'
export type TabId = 'live' | 'reconcile' | 'backstage' | 'terms' | 'relay'
export type CueSource = 'line' | 'desk'
export type DeliveryState = 'live' | 'deskQueued' | 'lineQueued' | 'lineRetry'
export type ReconcileState = 'none' | 'held' | 'resolvedLine' | 'resolvedDesk'

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
  /** 转写线路推送序号，两边都按这个序号对账、补送、重试 */
  seq: number
  /** 这条原始记录由哪一边记：line = 转写线路，desk = 口译位 */
  source: CueSource
  /** 旧条目补标记后保持启用（可被过滤），并记录是否来自旧数据 */
  enabled: boolean
  legacy: boolean
  speakerId: string
  text: string
  receivedAt: number
  status: CueStatus
  manual: boolean
  /** 口译位侧网络离线时产生（本机照记，恢复后按序号补送） */
  offline: boolean
  /** 送播状态：在线 / 口译位待补送 / 线路待重试 */
  delivery: DeliveryState
  delaySeconds: number
  duplicateOf: string | null
  followupText: string
  tags: string[]
  corrected: boolean
  /** 转写线路侧挂的“已上屏”段号 */
  lineOnScreen: boolean
  /** 口译位侧挂的“已上屏”段号 */
  deskOnScreen: boolean
  /** 收工对账结果：挂起待主管定 / 已按哪边为准 */
  reconcile: ReconcileState
  resolveNote: string
  retryCount: number
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
  /** 口译位网络（浏览器在线状态 + 手工补送） */
  online: boolean
  /** 转写线路通道：连接正常 / 断连 / 恢复失败待重试 */
  lineConnected: boolean
  lineRecoveryFailed: boolean
  liveSimulation: boolean
  /** 下一个推送序号 */
  nextSeq: number
  /** 旧条目迁移：打开时给缺来源的旧条目补标记的条数 */
  legacyImported: number
  updatedAt: string
}
