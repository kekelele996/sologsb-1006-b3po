<script lang="ts">
  import { onMount } from 'svelte'
  import Button from 'flowbite-svelte/Button.svelte'
  import {
    acknowledgeReminder, addAnnouncement, addSession, addSpeaker, addTerm, canRedo, canUndo, clearDuplicate,
    correctCue, deleteCue, desk, dismissLegacyNotice, getDelay, ingestCue, moveCue, publishAnnouncement,
    recoverDesk, recoverLine, redoDesk, reconcileOnScreen, resolveReconcile, retryLineBySeq,
    sendReminder, setActiveCue, setCueStatus, setFontScale, setLineDisconnected,
    setLiveSimulation, setOnline, speakerName, termTarget, toggleDeskOnScreen, toggleLineOnScreen,
    undoDesk, updateCue, updateSession, updateSpeaker, updateTerm
  } from '$lib/store'
  import type { Announcement, Cue, ReconcileState, Session, TabId, Term } from '$lib/types'

  const liveLines = [
    'Cooling corridors can connect parks, schools, and shaded transit stops.',
    'The program gives every district a shared baseline for heat risk.',
    'Community health workers are collecting temperature and respiratory data together.',
    'This evidence helps us prioritize investments where vulnerability is highest.',
    'We will publish the indicator framework before the next budget cycle.'
  ]
  let tab: TabId = 'live'
  let now = Date.now()
  let manualText = ''
  let manualSpeakerId = ''
  let followup = ''
  let notice = ''
  let announcementText = ''
  let announcementLevel: Announcement['level'] = 'info'
  let manualInput: HTMLTextAreaElement
  let simulationIndex = 0
  let showHelp = false
  let editingId = ''
  let editingText = ''
  let resolveNote = ''
  let retrySucceeds = true
  let reconcileSummary = ''

  $: enabledCues = $desk.cues.filter(item => item.enabled).sort((a, b) => a.seq - b.seq)
  $: currentSession = $desk.sessions.find(item => item.status === 'live') || $desk.sessions[0]
  $: activeCue = enabledCues.find(item => item.id === $desk.activeCueId) || enabledCues.at(-1)
  $: pendingCount = enabledCues.filter(item => item.status === 'pending').length
  $: offlineCount = enabledCues.filter(item => item.delivery === 'deskQueued').length
  $: lineQueueCount = enabledCues.filter(item => item.delivery === 'lineQueued' || item.delivery === 'lineRetry').length
  $: relayCount = offlineCount + lineQueueCount
  $: lateCount = enabledCues.filter(item => getDelay(item, now) > 8 && item.status !== 'confirmed').length
  $: duplicateCount = enabledCues.filter(item => item.duplicateOf).length
  $: heldCues = enabledCues.filter(item => item.reconcile === 'held')
  $: heldCount = heldCues.length
  $: lineScreenSeqs = enabledCues.filter(item => item.lineOnScreen).map(item => item.seq)
  $: deskScreenSeqs = enabledCues.filter(item => item.deskOnScreen).map(item => item.seq)
  $: deskQueuedCues = enabledCues.filter(item => item.delivery === 'deskQueued').sort((a, b) => a.seq - b.seq)
  $: lineQueuedCues = enabledCues.filter(item => item.delivery === 'lineQueued' || item.delivery === 'lineRetry').sort((a, b) => a.seq - b.seq)
  $: activeSpeaker = $desk.speakers.find(item => item.id === activeCue?.speakerId)
  $: activeTerms = $desk.terms.filter(item => item.speakerId === activeCue?.speakerId || activeCue?.tags.includes(item.target))
  $: unreadReminders = $desk.reminders.filter(item => !item.acknowledged)

  onMount(() => {
    if (typeof navigator !== 'undefined') setOnline(navigator.onLine)
    const onlineHandler = () => setOnline(true)
    const offlineHandler = () => setOnline(false)
    window.addEventListener('online', onlineHandler)
    window.addEventListener('offline', offlineHandler)
    window.addEventListener('keydown', handleKeyboard)
    const tick = window.setInterval(() => { now = Date.now() }, 1000)
    // 模拟转写线路推送：线路断连时自动进入线路待补送队列
    const simulate = window.setInterval(() => {
      if ($desk.liveSimulation) {
        ingestCue(liveLines[simulationIndex % liveLines.length], { source: 'line' })
        simulationIndex++
      }
    }, 16000)
    return () => {
      window.removeEventListener('online', onlineHandler)
      window.removeEventListener('offline', offlineHandler)
      window.removeEventListener('keydown', handleKeyboard)
      window.clearInterval(tick)
      window.clearInterval(simulate)
    }
  })

  function flash(message: string) {
    notice = message
    window.setTimeout(() => { if (notice === message) notice = '' }, 3200)
  }
  function seqLabel(cue: Cue): string { return `#${String(cue.seq).padStart(3, '0')}` }
  function selectCue(cue: Cue) {
    setActiveCue(cue.id)
    followup = ''
  }
  function confirmActive() {
    if (!activeCue || activeCue.status === 'quarantined') return
    setCueStatus(activeCue.id, 'confirmed')
    flash(`口译位已确认 ${seqLabel(activeCue)}，并挂上口译位已上屏段号；队列前进。`)
    moveCue(1)
  }
  function saveFollowup() {
    if (!activeCue || !followup.trim()) return
    updateCue(activeCue.id, { followupText: followup.trim(), status: 'followup' })
    followup = ''
    flash('遗漏内容已由口译位补充并标记为待跟进。')
  }
  function submitManual() {
    if (!manualText.trim()) return
    ingestCue(manualText, { manual: true, source: 'desk', speakerId: manualSpeakerId || activeCue?.speakerId })
    manualText = ''
    if (!$desk.online) flash('口译位断网中：已照旧本机记一份，恢复后按序号补送。')
    else flash('口译位手工录入已进入现场队列。')
  }
  function startCorrect(cue: Cue) {
    editingId = cue.id
    editingText = cue.text
  }
  function saveCorrect(cue: Cue) {
    if (!editingText.trim()) return
    const applied = correctCue(cue.id, editingText)
    editingId = ''
    flash(applied ? `${seqLabel(cue)} 尚未确认，线路更正已回填原话。` : `${seqLabel(cue)} 已确认，照旧不动，更正未回填。`)
  }
  function runReconcile() {
    const result = reconcileOnScreen()
    reconcileSummary = `对账完成：${result.matched.length - result.mismatched.length} 段两边一致，${result.mismatched.length} 段对不上，已留出等值班主管定。`
    if (!result.mismatched.length) flash('两边已上屏段号全部对得上。')
    else flash(`${result.mismatched.length} 段对不上，已挂起等待值班主管定夺。`)
  }
  function settle(cue: Cue, winner: 'line' | 'desk') {
    resolveReconcile(cue.id, winner, resolveNote)
    resolveNote = ''
    flash(`${seqLabel(cue)} 已按${winner === 'line' ? '转写线路' : '口译位'}那份定夺，两边段号已统一。`)
  }
  function deskRecover() {
    const { resent } = recoverDesk()
    flash(`口译位网络恢复：${resent} 条按序号补送完成，并重新执行重复检查。`)
  }
  function lineRecover(success: boolean) {
    recoverLine(success)
    flash(success ? '转写线路恢复成功：待补送条目已按序号送达。' : '转写线路恢复失败：条目保持按序号重试，口译位那份不受影响。')
  }
  function lineRetryAll() {
    const result = retryLineBySeq(retrySucceeds)
    flash(retrySucceeds
      ? `线路侧按序号重试完成：${result.done} 条送达。`
      : `线路侧按序号重试仍失败：${result.remaining} 条保留待重试。`)
  }
  function sendTermReminder(termId: string) {
    if (!activeCue) return
    sendReminder(termId, activeCue.id)
    flash(`术语提醒已发送：${termTarget($desk, termId)}`)
  }
  function createAnnouncement() {
    addAnnouncement(announcementText, announcementLevel)
    announcementText = ''
    flash('紧急通知已保存到后台。')
  }
  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  }
  function delayClass(seconds: number) {
    if (seconds > 12) return 'bg-red-100 text-red-800 border-red-200'
    if (seconds > 8) return 'bg-amber-100 text-amber-900 border-amber-200'
    return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  }
  function statusLabel(status: Cue['status']) {
    return ({ pending: '待传', confirmed: '已确认', followup: '有补充', quarantined: '已挂起' })[status]
  }
  function deliveryLabel(cue: Cue) {
    return ({
      live: '在线',
      deskQueued: '口译位待补送',
      lineQueued: '线路待补送',
      lineRetry: `线路重试中×${cue.retryCount || 1}`
    })[cue.delivery]
  }
  function reconcileLabel(state: ReconcileState) {
    return ({ none: '', held: '对不上 · 待主管定', resolvedLine: '已按线路定夺', resolvedDesk: '已按口译位定夺' })[state]
  }
  function cueBySeq(seq: number): Cue | undefined { return $desk.cues.find(item => item.seq === seq) }
  function handleKeyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault(); event.shiftKey ? redoDesk() : undoDesk(); return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redoDesk(); return }
    if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); moveCue(1) }
    if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); moveCue(-1) }
    if (event.key.toLowerCase() === 'c') { event.preventDefault(); confirmActive() }
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); tab = 'relay'; manualInput?.focus(); flash('口译位手工录入已获焦，输入后按 Ctrl + Enter 提交。') }
    if (event.key.toLowerCase() === 't' && activeTerms[0]) { event.preventDefault(); sendTermReminder(activeTerms[0].id) }
    if (event.key === '?') { event.preventDefault(); showHelp = true }
    if (event.key === '+' || event.key === '=') setFontScale($desk.fontScale + 5)
    if (event.key === '-') setFontScale($desk.fontScale - 5)
  }
</script>

<svelte:head><title>会议同传提示台 · Live Cue Desk</title></svelte:head>

<a class="fixed left-2 top-2 z-[100] -translate-y-20 rounded-lg bg-white px-4 py-2 font-bold shadow focus:translate-y-0" href="#main">跳到主要内容</a>

<div class="min-h-full bg-paper text-ink" style={`font-size:${$desk.fontScale}%`}>
  <header class="sticky top-0 z-40 border-b border-slate-800 bg-ink text-white shadow-xl">
    <div class="mx-auto flex max-w-[1800px] flex-wrap items-center gap-3 px-4 py-3">
      <div class="mr-3 flex items-center gap-3">
        <div class="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 font-black">译</div>
        <div><strong class="block tracking-tight">会议同传提示台</strong><span class="block text-[10px] uppercase tracking-[.16em] text-slate-400">Live Interpreter Cue Desk</span></div>
      </div>
      <nav class="order-3 flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-800/80 p-1 lg:order-none lg:w-auto" aria-label="工作区">
        {#each [['live','现场传译'],['reconcile','收工对账'],['backstage','后台准备'],['terms','术语与通知'],['relay','断网补送']] as item}
          <button class="focus-ring whitespace-nowrap rounded-lg px-4 py-2 text-xs font-bold transition {tab === item[0] ? 'bg-white text-ink shadow' : 'text-slate-300 hover:bg-slate-700'}" aria-current={tab === item[0] ? 'page' : undefined} on:click={() => tab = item[0] as TabId}>
            {item[1]}
            {#if item[0] === 'live' && pendingCount}<span class="ml-2 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] text-white">{pendingCount}</span>{/if}
            {#if item[0] === 'reconcile' && heldCount}<span class="ml-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">{heldCount}</span>{/if}
            {#if item[0] === 'relay' && relayCount}<span class="ml-2 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{relayCount}</span>{/if}
          </button>
        {/each}
      </nav>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <span class="rounded-full border px-3 py-1.5 text-[11px] font-bold {$desk.online ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : 'border-amber-500/40 bg-amber-500/50/15 text-amber-300'}">
          <span class="mr-2 inline-block h-2 w-2 rounded-full {$desk.online ? 'bg-emerald-400' : 'bg-amber-400'}"></span>口译位 {$desk.online ? '在线' : '断网照记'}
        </span>
        <span class="rounded-full border px-3 py-1.5 text-[11px] font-bold {$desk.lineConnected ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300' : $desk.lineRecoveryFailed ? 'border-red-500/40 bg-red-500/15 text-red-300' : 'border-amber-500/40 bg-amber-500/15 text-amber-300'}">
          <span class="mr-2 inline-block h-2 w-2 rounded-full {$desk.lineConnected ? 'bg-emerald-400' : $desk.lineRecoveryFailed ? 'bg-red-400' : 'bg-amber-400'}"></span>转写线路 {$desk.lineConnected ? '已连接' : $desk.lineRecoveryFailed ? '恢复失败 · 重试' : '断连排队'}
        </span>
        <div class="flex items-center rounded-lg bg-slate-800 p-1">
          <button class="focus-ring h-7 w-7 rounded text-lg" title="缩小字号" on:click={() => setFontScale($desk.fontScale - 5)}>−</button>
          <span class="w-12 text-center text-[11px]">{$desk.fontScale}%</span>
          <button class="focus-ring h-7 w-7 rounded text-lg" title="放大字号" on:click={() => setFontScale($desk.fontScale + 5)}>＋</button>
        </div>
        <Button size="sm" color="light" on:click={() => showHelp = true}>快捷键</Button>
      </div>
    </div>
  </header>

  {#if notice}<div role="status" class="fixed right-5 top-24 z-50 max-w-md rounded-xl border border-teal-200 bg-white px-4 py-3 text-sm font-bold text-teal-800 shadow-2xl">{notice}</div>{/if}

  {#if $desk.legacyImported > 0}
    <div class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900">
      <div class="mx-auto flex max-w-[1800px] items-center justify-between gap-3">
        <span>检测到 {$desk.legacyImported} 条旧条目未记来源：已按“转写线路”补上来源标记并保持启用。</span>
        <button class="rounded-lg border border-amber-300 px-2 py-1" on:click={dismissLegacyNotice}>知道了</button>
      </div>
    </div>
  {/if}

  <main id="main" class="mx-auto max-w-[1800px] p-4 lg:p-6">
    {#if tab === 'live'}
      <div class="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">当前场次 · {$desk.online && $desk.lineConnected ? 'LIVE' : 'DEGRADED'}</p>
          <h1 class="mt-1 text-2xl font-black tracking-tight lg:text-4xl">{currentSession?.title}</h1>
          <p class="mt-2 text-sm text-slate-500">{currentSession?.time} · {currentSession?.room} · {$desk.speakers.find(item => item.id === currentSession?.speakerId)?.name}</p>
        </div>
        <div class="grid grid-cols-4 gap-2 text-center">
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl">{pendingCount}</strong><span class="text-[10px] text-slate-500">待传</span></div>
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-amber-700">{lateCount}</strong><span class="text-[10px] text-slate-500">偏高延迟</span></div>
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-red-700">{duplicateCount}</strong><span class="text-[10px] text-slate-500">疑似重复</span></div>
          <div class="rounded-xl border bg-white px-4 py-2"><strong class="block text-xl text-purple-700">{heldCount}</strong><span class="text-[10px] text-slate-500">对账挂起</span></div>
        </div>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(300px,.75fr)]">
        <div class="space-y-4">
          <section class="overflow-hidden rounded-2xl border border-teal-800 bg-[#0d3b36] text-white shadow-lg">
            <div class="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-200">现场可见内容 · 两边段号一致才上屏</span><h2 class="mt-1 font-bold">舞台字幕与紧急通知</h2></div>
              <span class="rounded-full bg-teal-600 px-2.5 py-1 text-[10px] font-black text-white">STAGE OUTPUT</span>
            </div>
            <div class="space-y-3 p-4">
              {#each $desk.announcements.filter(item => item.visibleOnStage) as item}
                <div class="rounded-xl border border-orange-300/30 bg-orange-500/15 p-3"><strong class="text-xs text-orange-200">紧急通知</strong><p class="mt-1 text-lg font-bold">{item.text}</p></div>
              {/each}
              {#each enabledCues.filter(item => item.lineOnScreen && item.deskOnScreen && (item.reconcile === 'none' || item.reconcile.startsWith('resolved'))).slice(-2) as cue}
                <div class="rounded-xl bg-white/10 p-3">
                  <div class="mb-1 flex justify-between text-[10px] text-teal-200"><span>{seqLabel(cue)} · {speakerName($desk, cue.speakerId)}</span><span>{formatTime(cue.receivedAt)}</span></div>
                  <p class="text-base leading-relaxed lg:text-lg">{cue.text}</p>
                </div>
              {/each}
              {#if !enabledCues.some(item => item.lineOnScreen && item.deskOnScreen) && !$desk.announcements.some(item => item.visibleOnStage)}
                <p class="py-5 text-center text-sm text-teal-100/60">两边都挂上同一段号（且对账无挂起）后，现场可见内容将在这里出现。</p>
              {/if}
            </div>
          </section>

          <section class="rounded-2xl border bg-white shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">两边各记一份 · 线路管序号与原话，口译位管确认与补译</span>
                <h2 class="mt-1 font-bold">段落队列（按推送序号）</h2>
              </div>
              <div class="flex items-center gap-3 text-xs text-slate-50"><span>线路自动接入</span><button type="button" role="switch" aria-label="自动接入现场文字" aria-checked={$desk.liveSimulation} class="focus-ring h-6 w-11 rounded-full p-1 transition {$desk.liveSimulation ? 'bg-teal-600' : 'bg-slate-300'}" on:click={() => setLiveSimulation(!$desk.liveSimulation)}><span class="block h-4 w-4 rounded-full bg-white transition {$desk.liveSimulation ? 'translate-x-5' : ''}"></span></button></div>
            </div>
            <div class="border-b bg-slate-50 px-4 py-2 text-[10px] font-bold text-slate-500">
              <span class="mr-4">■ 勾选 = 该侧已把这段号挂为“已上屏”</span>
              <span class="mr-4"><span class="inline-block h-2.5 w-2.5 rounded-sm bg-sky-500 align-middle"></span> 转写线路</span>
              <span><span class="inline-block h-2.5 w-2.5 rounded-sm bg-violet-500 align-middle"></span> 口译位</span>
            </div>
            <div class="max-h-[640px] space-y-2 overflow-y-auto p-3 scrollbar-thin">
              {#each enabledCues as cue}
                <!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
                <article role="button" tabindex="0" class="cue-enter cursor-pointer rounded-xl border p-3 transition {cue.id === $desk.activeCueId ? 'border-teal-600 bg-teal-50 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300'} {cue.reconcile === 'held' ? 'ring-2 ring-purple-300' : ''}" on:click={() => selectCue(cue)} on:keydown={event => (event.key === 'Enter' || event.key === ' ') && selectCue(cue)}>
                  <div class="flex flex-wrap items-start gap-3">
                    <span class="grid h-8 min-w-8 shrink-0 place-items-center rounded-lg bg-slate-900 px-1.5 text-[11px] font-black text-white">{seqLabel(cue)}</span>
                    <div class="min-w-0 flex-1">
                      <div class="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-bold">
                        <span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{speakerName($desk, cue.speakerId)}</span>
                        <span class="rounded-md px-2 py-1 {cue.source === 'line' ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}">{cue.source === 'line' ? '转写线路' : '口译位'}{cue.legacy ? ' · 旧条目补标' : ''}</span>
                        <span class="rounded-md border px-2 py-1 {delayClass(getDelay(cue, now))}">{formatTime(cue.receivedAt)} · 延迟 {getDelay(cue, now)}s</span>
                        <span class="rounded-md px-2 py-1 {cue.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : cue.status === 'followup' ? 'bg-amber-100 text-amber-900' : cue.status === 'quarantined' ? 'bg-purple-100 text-purple-900' : 'bg-blue-100 text-blue-800'}">{statusLabel(cue.status)}</span>
                        {#if cue.delivery !== 'live'}<span class="rounded-md bg-amber-100 px-2 py-1 text-amber-900">{deliveryLabel(cue)}</span>{/if}
                        {#if cue.corrected}<span class="rounded-md bg-sky-100 px-2 py-1 text-sky-800">线路已更正</span>{/if}
                        {#if cue.reconcile !== 'none'}<span class="rounded-md {cue.reconcile === 'held' ? 'bg-purple-200 text-purple-900' : 'bg-emerald-100 text-emerald-800'} px-2 py-1">{reconcileLabel(cue.reconcile)}</span>{/if}
                      </div>
                      {#if editingId === cue.id}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <div class="space-y-2" on:click|stopPropagation on:keydown|stopPropagation>
                          <textarea class="focus-ring w-full rounded-lg border border-sky-300 p-2 text-sm" rows="2" bind:value={editingText}></textarea>
                          <div class="flex gap-2">
                            <Button size="xs" color="blue" on:click={() => saveCorrect(cue)}>回填更正</Button>
                            <Button size="xs" color="light" on:click={() => editingId = ''}>取消</Button>
                            <span class="self-center text-[10px] text-slate-400">已确认段不会被回填</span>
                          </div>
                        </div>
                      {:else}
                        <p class="text-sm leading-6 lg:text-base">{cue.text}</p>
                      {/if}
                      {#if cue.duplicateOf}
                        <div class="mt-2 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          <span><strong>疑似重复：</strong>与 {(() => { const dup = $desk.cues.find(item => item.id === cue.duplicateOf); return dup ? seqLabel(dup) : '另一段' })()} 高度相似</span>
                          <button class="font-black underline" on:click|stopPropagation={() => clearDuplicate(cue.id)}>确认非重复</button>
                        </div>
                      {/if}
                      {#if cue.followupText}<p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900"><strong>口译位补译：</strong>{cue.followupText}</p>{/if}
                      {#if cue.resolveNote}<p class="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><strong>主管定夺备注：</strong>{cue.resolveNote}</p>{/if}
                      <div class="mt-2 flex flex-wrap items-center gap-1">
                        {#each cue.tags as tag}<span class="rounded-full bg-teal-100 px-2 py-1 text-[10px] font-bold text-teal-800">{tag}</span>{/each}
                        <!-- svelte-ignore a11y_no_static_element_interactions -->
                        <span class="ml-auto flex items-center gap-3 text-[10px] font-bold" on:click|stopPropagation on:keydown|stopPropagation>
                          <label class="flex items-center gap-1 text-sky-700"><input type="checkbox" class="focus-ring" checked={cue.lineOnScreen} on:change={() => toggleLineOnScreen(cue.id)} /> 线路已上屏</label>
                          <label class="flex items-center gap-1 text-violet-700"><input type="checkbox" class="focus-ring" checked={cue.deskOnScreen} on:change={() => toggleDeskOnScreen(cue.id)} /> 口译位已上屏</label>
                          {#if cue.source === 'line' && cue.status !== 'confirmed'}
                            <button class="rounded-md border px-2 py-1 text-sky-700" on:click={() => startCorrect(cue)}>线路更正</button>
                          {/if}
                          <button class="rounded-md border px-2 py-1 text-red-600" on:click={() => deleteCue(cue.id)}>删除</button>
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              {/each}
              {#if !enabledCues.length}<p class="py-8 text-center text-sm text-slate-400">暂无启用段落。</p>{/if}
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-start justify-between gap-3">
              <div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">当前口译位 · 管确认结果与补译</span><h2 class="mt-1 font-bold">{activeSpeaker?.name || '等待队列'}</h2><p class="text-xs text-slate-500">{activeCue ? `${seqLabel(activeCue)} · ${activeCue.source === 'line' ? '原话来自转写线路' : '口译位手工记录'}` : activeSpeaker?.language}</p></div>
              <div class="flex gap-1"><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="上一条" on:click={() => moveCue(-1)}>↑</button><button class="focus-ring rounded-lg border px-2 py-1 text-xs" aria-label="下一条" on:click={() => moveCue(1)}>↓</button></div>
            </div>
            {#if activeCue}
              <div class="rounded-xl bg-slate-50 p-3">
                <p class="text-sm leading-6">{activeCue.text}</p>
                {#if activeCue.corrected}<p class="mt-1 text-[10px] font-bold text-sky-700">原话已由转写线路更正回填</p>{/if}
                <p class="mt-2 text-[10px] text-slate-500">快捷键：J / K 移动，C 确认（自动挂口译位上屏号），T 发送首条术语提醒</p>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <Button color="green" disabled={activeCue.status === 'quarantined'} on:click={confirmActive}>确认已传 <kbd class="ml-1 text-[10px]">C</kbd></Button>
                <Button color="yellow" on:click={() => tab = 'relay'}>口译位补记</Button>
              </div>
              {#if activeCue.status === 'quarantined'}<p class="mt-2 rounded-lg bg-purple-50 px-3 py-2 text-[11px] font-bold text-purple-800">此段对账挂起，需在“收工对账”页等值班主管定夺后才能继续。</p>{/if}
              <label for="followup-input" class="mt-4 block text-[10px] font-black uppercase tracking-wider text-slate-500">遗漏补译（口译位这份）</label>
              <textarea id="followup-input" class="focus-ring mt-2 w-full rounded-xl border p-3 text-sm" rows="3" bind:value={followup} placeholder="输入遗漏内容或修正术语…"></textarea>
              <Button class="mt-2 w-full" color="light" disabled={!followup.trim()} on:click={saveFollowup}>标记补充完成</Button>
            {/if}
          </section>

          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-center justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">术语提醒</span><h2 class="mt-1 font-bold">当前发言人术语</h2></div><span class="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">{activeTerms.length}</span></div>
            <div class="space-y-2">
              {#each activeTerms as term}
                <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3">
                  <div><strong class="block text-xs">{term.target}</strong><span class="text-[10px] text-slate-500">{term.source} · {term.note}</span></div>
                  <Button size="xs" color={term.priority === 'high' ? 'yellow' : 'light'} on:click={() => sendTermReminder(term.id)}>提醒</Button>
                </div>
              {/each}
            </div>
          </section>

          <section class="rounded-2xl border bg-white p-4 shadow-sm">
            <div class="mb-3 flex items-center justify-between"><h2 class="font-bold">已发送提醒</h2><span class="text-xs text-slate-500">{unreadReminders.length} 条未确认</span></div>
            <div class="max-h-52 space-y-2 overflow-y-auto">
              {#each $desk.reminders as reminder}
                <div class="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs {reminder.acknowledged ? 'bg-slate-50 text-slate-400' : 'bg-teal-50 text-teal-900'}">
                  <span><strong>{reminder.target}</strong> · {formatTime(reminder.createdAt)}</span>
                  {#if !reminder.acknowledged}<button class="font-bold underline" on:click={() => acknowledgeReminder(reminder.id)}>已看到</button>{/if}
                </div>
              {/each}
              {#if !$desk.reminders.length}<p class="py-4 text-center text-xs text-slate-400">尚未发送术语提醒。</p>{/if}
            </div>
          </section>
        </div>
      </div>
    {/if}

    {#if tab === 'reconcile'}
      <div class="mb-5">
        <p class="text-[10px] font-black uppercase tracking-[.18em] text-purple-700">收工前对账 · 两边挂的已上屏段号</p>
        <h1 class="mt-1 text-3xl font-black">转写线路 × 口译位 上屏段号对账</h1>
        <p class="mt-2 text-sm text-slate-500">两边段号一致才算对上；对不上的段先留出挂起，等值班主管在下方按其中一份定夺。</p>
      </div>

      <div class="mb-4 flex flex-wrap items-center gap-3">
        <Button color="purple" on:click={runReconcile}>立即对账</Button>
        {#if reconcileSummary}<span class="text-xs font-bold text-slate-600">{reconcileSummary}</span>{/if}
      </div>

      <div class="grid gap-4 lg:grid-cols-2">
        <section class="rounded-2xl border border-sky-200 bg-white p-4 shadow-sm">
          <h2 class="font-black text-sky-800">转写线路挂的已上屏段号（{lineScreenSeqs.length}）</h2>
          <div class="mt-3 flex flex-wrap gap-2">
            {#each lineScreenSeqs as seq}
              <button class="rounded-lg bg-sky-100 px-3 py-1.5 text-xs font-black text-sky-800" on:click={() => { const c = cueBySeq(seq); if (c) setActiveCue(c.id) }}>#{String(seq).padStart(3, '0')}</button>
            {/each}
            {#if !lineScreenSeqs.length}<p class="text-xs text-slate-400">线路侧还没挂任何上屏段号。</p>{/if}
          </div>
        </section>
        <section class="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
          <h2 class="font-black text-violet-800">口译位挂的已上屏段号（{deskScreenSeqs.length}）</h2>
          <div class="mt-3 flex flex-wrap gap-2">
            {#each deskScreenSeqs as seq}
              <button class="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-black text-violet-800" on:click={() => { const c = cueBySeq(seq); if (c) setActiveCue(c.id) }}>#{String(seq).padStart(3, '0')}</button>
            {/each}
            {#if !deskScreenSeqs.length}<p class="text-xs text-slate-400">口译位还没挂任何上屏段号。</p>{/if}
          </div>
        </section>
      </div>

      <section class="mt-4 rounded-2xl border border-purple-300 bg-purple-50/60 p-4 shadow-sm">
        <h2 class="font-black text-purple-900">对不上 · 已留出等值班主管定（{heldCues.length}）</h2>
        <div class="mt-3 space-y-3">
          {#each heldCues as cue}
            <article class="rounded-xl border border-purple-200 bg-white p-4">
              <div class="flex flex-wrap items-center gap-2 text-[10px] font-bold">
                <span class="rounded-md bg-slate-900 px-2 py-1 text-white">{seqLabel(cue)}</span>
                <span class="rounded-md bg-sky-100 px-2 py-1 text-sky-800">线路{cue.lineOnScreen ? '已上屏' : '未上屏'}</span>
                <span class="rounded-md bg-violet-100 px-2 py-1 text-violet-800">口译位{cue.deskOnScreen ? '已上屏' : '未上屏'}</span>
                <span class="rounded-md bg-slate-100 px-2 py-1 text-slate-600">{speakerName($desk, cue.speakerId)}</span>
              </div>
              <p class="mt-2 text-sm leading-6">{cue.text}</p>
              {#if cue.followupText}<p class="mt-1 text-xs text-amber-800"><strong>口译位补译：</strong>{cue.followupText}</p>{/if}
              <div class="mt-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <input class="focus-ring rounded-lg border px-3 py-2 text-xs" placeholder="值班主管定夺备注（可选）" bind:value={resolveNote} />
                <Button size="sm" color="blue" on:click={() => settle(cue, 'line')}>以线路为准</Button>
                <Button size="sm" color="purple" on:click={() => settle(cue, 'desk')}>以口译位为准</Button>
              </div>
            </article>
          {/each}
          {#if !heldCues.length}<p class="py-6 text-center text-sm text-slate-500">没有挂起段。可先在现场队列里分别勾选两边的“已上屏”，再点“立即对账”。</p>{/if}
        </div>
      </section>

      <section class="mt-4 rounded-2xl border bg-white p-4 shadow-sm">
        <h2 class="font-black">段号对账明细</h2>
        <div class="mt-3 overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-xs">
            <thead class="uppercase tracking-wider text-slate-500"><tr><th class="p-2">段号</th><th class="p-2">来源</th><th class="p-2">原话 / 补译</th><th class="p-2">线路上屏</th><th class="p-2">口译位上屏</th><th class="p-2">对账状态</th></tr></thead>
            <tbody>
              {#each enabledCues as cue}
                <tr class="border-t {cue.reconcile === 'held' ? 'bg-purple-50' : ''}">
                  <td class="p-2 font-black">{seqLabel(cue)}</td>
                  <td class="p-2">{cue.source === 'line' ? '转写线路' : '口译位'}</td>
                  <td class="p-2"><p>{cue.text}</p>{#if cue.followupText}<p class="text-amber-700">{cue.followupText}</p>{/if}</td>
                  <td class="p-2">{cue.lineOnScreen ? '✓' : '—'}</td>
                  <td class="p-2">{cue.deskOnScreen ? '✓' : '—'}</td>
                  <td class="p-2 font-bold">{cue.reconcile === 'none' ? (cue.lineOnScreen === cue.deskOnScreen ? '一致' : '未对账') : reconcileLabel(cue.reconcile)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    {#if tab === 'backstage'}
      <div class="mb-5"><p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">后台准备内容 · 不会直接显示给现场</p><h1 class="mt-1 text-3xl font-black">议程、发言人与紧急通知</h1></div>
      <div class="grid gap-4 xl:grid-cols-[1.3fr_.7fr]">
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between"><div><h2 class="font-black">演讲顺序</h2><p class="text-xs text-slate-500">拖动时间、状态或发言人即可更新后台准备内容。</p></div><Button size="sm" on:click={addSession}>新增场次</Button></div>
          <div class="space-y-3">
            {#each $desk.sessions.sort((a,b) => a.order - b.order) as session}
              <article class="grid gap-3 rounded-xl border p-3 md:grid-cols-[80px_1fr_190px_120px]">
                <input class="focus-ring rounded-lg border px-2 py-2 text-sm font-bold" type="time" value={session.time} on:change={event => updateSession(session.id, { time: (event.target as HTMLInputElement).value })} />
                <div><input class="focus-ring w-full rounded-lg border px-3 py-2 font-bold" value={session.title} on:change={event => updateSession(session.id, { title: (event.target as HTMLInputElement).value })} /><span class="mt-1 block text-[10px] text-slate-500">{session.room}</span></div>
                <select class="focus-ring rounded-lg border px-2" value={session.speakerId} on:change={event => updateSession(session.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each $desk.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select>
                <select class="focus-ring rounded-lg border px-2" value={session.status} on:change={event => updateSession(session.id, { status: (event.target as HTMLSelectElement).value as Session['status'] })}><option value="upcoming">未开始</option><option value="live">进行中</option><option value="done">已结束</option></select>
              </article>
            {/each}
          </div>
        </section>
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4 flex items-center justify-between"><div><h2 class="font-black">发言人</h2><p class="text-xs text-slate-500">语气、语言方向与标识颜色。</p></div><Button size="sm" color="light" on:click={addSpeaker}>新增</Button></div>
          <div class="space-y-3">
            {#each $desk.speakers as speaker}
              <div class="rounded-xl border p-3">
                <div class="flex items-center gap-2"><input class="focus-ring h-8 w-8 rounded-lg border-0 p-1" type="color" value={speaker.color} aria-label="标识颜色" on:change={event => updateSpeaker(speaker.id, { color: (event.target as HTMLInputElement).value })} /><input class="focus-ring min-w-0 flex-1 rounded-lg border px-3 py-2 font-bold" value={speaker.name} on:change={event => updateSpeaker(speaker.id, { name: (event.target as HTMLInputElement).value })} /></div>
                <input class="focus-ring mt-2 w-full rounded-lg border px-3 py-2 text-xs" value={speaker.title} on:change={event => updateSpeaker(speaker.id, { title: (event.target as HTMLInputElement).value })} />
                <input class="focus-ring mt-2 w-full rounded-lg border px-3 py-2 text-xs" value={speaker.language} on:change={event => updateSpeaker(speaker.id, { language: (event.target as HTMLInputElement).value })} />
              </div>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    {#if tab === 'terms'}
      <div class="mb-5"><p class="text-[10px] font-black uppercase tracking-[.18em] text-teal-700">后台内容与现场动作</p><h1 class="mt-1 text-3xl font-black">术语表、紧急通知与发布闸门</h1></div>
      <div class="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <section class="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div class="flex items-center justify-between border-b p-4"><div><h2 class="font-black">术语表</h2><p class="text-xs text-slate-500">“发送提醒”只影响当前口译位，不发布到现场。</p></div><Button size="sm" on:click={addTerm}>新增术语</Button></div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[760px] text-left text-xs">
              <thead class="bg-slate-50 uppercase tracking-wider text-slate-500"><tr><th class="p-3">原文</th><th class="p-3">指定译法</th><th class="p-3">说明</th><th class="p-3">发言人</th><th class="p-3">优先级</th><th class="p-3"></th></tr></thead>
              <tbody>{#each $desk.terms as term}<tr class="border-t"><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.source} on:change={event => updateTerm(term.id, { source: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2 font-bold" value={term.target} on:change={event => updateTerm(term.id, { target: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><input class="focus-ring w-full rounded border px-2 py-2" value={term.note} on:change={event => updateTerm(term.id, { note: (event.target as HTMLInputElement).value })} /></td><td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.speakerId} on:change={event => updateTerm(term.id, { speakerId: (event.target as HTMLSelectElement).value })}>{#each $desk.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select></td><td class="p-2"><select class="focus-ring rounded border px-2 py-2" value={term.priority} on:change={event => updateTerm(term.id, { priority: (event.target as HTMLSelectElement).value as Term['priority'] })}><option value="normal">常规</option><option value="high">高优先</option></select></td><td class="p-2"><Button size="xs" color="yellow" disabled={!activeCue} on:click={() => sendTermReminder(term.id)}>发送</Button></td></tr>{/each}</tbody>
            </table>
          </div>
        </section>
        <section class="rounded-2xl border bg-white p-4 shadow-sm">
          <div class="mb-4"><h2 class="font-black">紧急通知</h2><p class="text-xs text-slate-500">先保存到后台，再由管理员明确发布到现场。</p></div>
          <select class="focus-ring w-full rounded-xl border p-3 text-sm" bind:value={announcementLevel}><option value="info">信息提示</option><option value="warning">时间提醒</option><option value="urgent">紧急通知</option></select>
          <textarea class="focus-ring mt-3 w-full rounded-xl border p-3 text-sm" rows="3" bind:value={announcementText} placeholder="输入通知内容…"></textarea>
          <Button class="mt-3 w-full" disabled={!announcementText.trim()} on:click={createAnnouncement}>保存到后台</Button>
          <div class="mt-6 space-y-3">
            {#each $desk.announcements as announcement}
              <div class="rounded-xl border p-3 {announcement.visibleOnStage ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-slate-50'}">
                <div class="flex items-center justify-between gap-3"><span class="rounded-full bg-white px-2 py-1 text-[10px] font-bold">{announcement.level === 'urgent' ? '紧急' : announcement.level === 'warning' ? '提醒' : '信息'}</span><span class="text-[10px] font-bold {announcement.visibleOnStage ? 'text-orange-700' : 'text-slate-500'}">{announcement.visibleOnStage ? '现场可见' : '仅后台'}</span></div>
                <p class="my-2 text-sm font-bold">{announcement.text}</p>
                <Button size="xs" color={announcement.visibleOnStage ? 'light' : 'yellow'} on:click={() => publishAnnouncement(announcement.id, !announcement.visibleOnStage)}>{announcement.visibleOnStage ? '撤下现场' : '发布到现场'}</Button>
              </div>
            {/each}
          </div>
        </section>
      </div>
    {/if}

    {#if tab === 'relay'}
      <div class="mb-5"><p class="text-[10px] font-black uppercase tracking-[.18em] text-amber-700">两边断网互不影响 · 恢复后各按各的序号补送 / 重试</p><h1 class="mt-1 text-3xl font-black">口译位补送 × 转写线路重试</h1></div>
      <div class="grid gap-4 xl:grid-cols-2">
        <!-- 口译位侧 -->
        <section class="offline-hatch rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 class="font-black text-violet-900">口译位 · 断网照旧记</h2><p class="text-xs text-slate-500">本机继续记一份（带推送序号），恢复后按序号补送，线路侧完全不受影响。</p></div>
            <span class="rounded-full px-3 py-1 text-xs font-bold {$desk.online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}">{$desk.online ? '在线' : '断网 · 本机照记'}</span>
          </div>

          <div class="mb-4 flex flex-wrap gap-2">
            <Button size="sm" color="light" on:click={() => setOnline(false)}>模拟口译位断网</Button>
            <Button size="sm" color="green" disabled={$desk.online} on:click={deskRecover}>恢复并按序号补送（{offlineCount}）</Button>
          </div>

          <label class="text-xs font-bold">发言人或场次<select class="focus-ring mt-2 w-full rounded-xl border p-3" bind:value={manualSpeakerId}><option value="">跟随当前发言人</option>{#each $desk.speakers as speaker}<option value={speaker.id}>{speaker.name}</option>{/each}</select></label>
          <label class="mt-3 block text-xs font-bold">口译位现场文字<textarea bind:this={manualInput} class="focus-ring mt-2 w-full rounded-xl border p-4 text-base leading-7" rows="6" bind:value={manualText} placeholder="网络中断时，口译位仍在这里继续记…" on:keydown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submitManual() }}></textarea></label>
          <Button class="mt-3 w-full" size="lg" disabled={!manualText.trim()} on:click={submitManual}>口译位记一笔</Button>

          <div class="mt-5 space-y-3">
            <h3 class="text-xs font-black uppercase tracking-wider text-slate-500">待按序号补送（{deskQueuedCues.length}）</h3>
            {#each deskQueuedCues as cue}
              <article class="rounded-xl border border-dashed border-violet-300 bg-violet-50/60 p-3">
                <div class="flex items-center justify-between text-[10px] font-bold text-violet-800"><span>{seqLabel(cue)} · 本机暂存 {formatTime(cue.receivedAt)}</span><span>{speakerName($desk, cue.speakerId)}</span></div>
                <textarea class="focus-ring mt-2 w-full rounded-xl border border-violet-200 bg-white p-2 text-sm" rows="2" value={cue.text} on:change={event => updateCue(cue.id, { text: (event.target as HTMLTextAreaElement).value })}></textarea>
                <div class="mt-1 flex justify-end"><button class="text-xs font-bold text-red-700 underline" on:click={() => deleteCue(cue.id)}>删除此笔</button></div>
              </article>
            {/each}
            {#if !deskQueuedCues.length}<p class="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-400">口译位没有待补送记录。断网后手工录入会按序号排在这里。</p>{/if}
          </div>
        </section>

        <!-- 转写线路侧 -->
        <section class="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 class="font-black text-sky-900">转写线路 · 恢复失败后按序号重试</h2><p class="text-xs text-slate-500">断连期间推送排队；可模拟“恢复失败”，条目转为按序号重试；口译位那份不受任何影响。</p></div>
            <span class="rounded-full px-3 py-1 text-xs font-bold {$desk.lineConnected ? 'bg-emerald-100 text-emerald-800' : $desk.lineRecoveryFailed ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}">{$desk.lineConnected ? '已连接' : $desk.lineRecoveryFailed ? '恢复失败 · 重试' : '断连 · 排队'}</span>
          </div>

          <div class="mb-4 flex flex-wrap gap-2">
            <Button size="sm" color="light" disabled={!$desk.lineConnected} on:click={setLineDisconnected}>模拟线路断连</Button>
            <Button size="sm" color="red" disabled={$desk.lineConnected} on:click={() => lineRecover(false)}>模拟恢复失败</Button>
            <Button size="sm" color="green" disabled={$desk.lineConnected} on:click={() => lineRecover(true)}>恢复成功（按序号送达）</Button>
          </div>
          <label class="flex items-center gap-2 text-xs font-bold text-slate-600"><input type="checkbox" class="focus-ring" bind:checked={retrySucceeds} /> 下面的“按序号重试”本次会成功（取消勾选模拟持续失败）</label>
          <Button class="mt-3 w-full" color="blue" disabled={!lineQueuedCues.length} on:click={lineRetryAll}>按序号重试全部（{lineQueuedCues.length}）</Button>

          <div class="mt-5 space-y-3">
            <h3 class="text-xs font-black uppercase tracking-wider text-slate-500">线路待补送 / 重试（按序号）</h3>
            {#each lineQueuedCues as cue}
              <article class="rounded-xl border {cue.delivery === 'lineRetry' ? 'border-red-300 bg-red-50/60' : 'border-dashed border-sky-300 bg-sky-50/60'} p-3">
                <div class="flex items-center justify-between text-[10px] font-bold {cue.delivery === 'lineRetry' ? 'text-red-800' : 'text-sky-800'}">
                  <span>{seqLabel(cue)} · {deliveryLabel(cue)}</span><span>{formatTime(cue.receivedAt)}</span>
                </div>
                <p class="mt-2 text-sm leading-6">{cue.text}</p>
              </article>
            {/each}
            {#if !lineQueuedCues.length}<p class="rounded-xl bg-slate-50 p-4 text-center text-xs text-slate-400">线路侧没有待补送条目。断连期间的自动推送会按序号排在这里。</p>{/if}
          </div>
        </section>
      </div>
    {/if}
  </main>

  <footer class="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 pb-6 text-[11px] text-slate-500 lg:px-6"><span>本机自动保存 · 最近更新 {new Date($desk.updatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span><span>线路管序号与原话 · 口译位管确认与补译 · 收工前对账</span><div class="flex gap-2"><button class="font-bold underline disabled:opacity-40" disabled={!canUndo()} on:click={undoDesk}>撤销</button><button class="font-bold underline disabled:opacity-40" disabled={!canRedo()} on:click={redoDesk}>重做</button></div></footer>
</div>

{#if showHelp}
  <div class="fixed inset-0 z-[80] grid place-items-center bg-slate-950/60 p-4" role="presentation" on:click={() => showHelp = false} on:keydown={event => event.key === 'Escape' && (showHelp = false)}>
    <div class="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl" role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="shortcut-title" on:click|stopPropagation on:keydown|stopPropagation>
      <div class="flex items-start justify-between"><div><span class="text-[10px] font-black uppercase tracking-[.16em] text-teal-700">Keyboard First</span><h2 id="shortcut-title" class="mt-1 text-xl font-black">键盘操作</h2></div><button class="rounded-lg px-2 py-1 text-xl" aria-label="关闭" on:click={() => showHelp = false}>×</button></div>
      <div class="mt-4 grid gap-2 sm:grid-cols-2">
        {#each [['J / ↓','下一条队列'],['K / ↑','上一条队列'],['C','确认已传（挂口译位上屏号）并前进'],['N','前往口译位补记并聚焦'],['T','发送当前高优先术语'],['+ / −','调整界面字号'],['Ctrl + Z','撤销'],['Ctrl + Shift + Z','重做']] as shortcut}
          <div class="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"><kbd class="rounded-md border bg-white px-2 py-1 text-xs font-black">{shortcut[0]}</kbd><span class="text-xs text-slate-600">{shortcut[1]}</span></div>
        {/each}
      </div>
      <p class="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-500">线路更正只回填未确认段；两边“已上屏”勾选收工前到“收工对账”页核对，对不上的先挂起等值班主管定。</p>
    </div>
  </div>
{/if}
