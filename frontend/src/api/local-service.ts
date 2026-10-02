import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { DEFAULT_TOWNSHIPS } from '@/data/townships'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'
import { useSessionStore } from '@/stores/session'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// —— 隐患点建档：按管辖乡镇收口的规则（与 README「隐患点建档的管辖规则」一节保持一致）——
// 1. 隐患编号归属哪个乡镇（记录的「所在乡镇」），就只有那个乡镇的值班人员能改；
//    跨乡镇提交核查、列入重点防范、登记消除一律挡下，并写清被拒原因。
// 2. 管辖乡镇与灾害类型冲突时，一律以管辖乡镇（所在乡镇）为准：
//    灾害类型只是业务属性，不参与权限判定。
// 3. 所在乡镇为空按无效值处理：直接退回，要求补填管辖乡镇后再提交。
// 4. 状态只能沿 待核查 → 建档中 → 重点防范 → 已消除 顺向推进，不跨级、不回退；
//    变过状态的记录对其他乡镇只读。
// 5. 重复提交是幂等的：已处于目标状态不再改动，预警台账按 WARN-<隐患编号> 去重，
//    不会多出第二条记录。
const HAZARD_KEY = 'hazard'
const HAZARD_TOWNSHIP_FIELD = '所在乡镇'
const HAZARD_CODE_FIELD = '隐患编号'
const WARNING_KEY = 'warning'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 全站唯一的值班乡镇来源：表头、隐患页权限提示、管辖校验都从这里取，保证各入口是同一份。
export function currentDutyTownship(): string {
  return useSessionStore().township.trim()
}

// 乡镇下拉选项：隐患点台账里实际出现的乡镇优先，字典兜底，两边本来就是同一份来源。
export function townshipOptions(): string[] {
  const fromLedger = listRows(HAZARD_KEY)
    .map((row) => String(row[HAZARD_TOWNSHIP_FIELD] ?? '').trim())
    .filter((name) => name !== '')
  return [...new Set([...fromLedger, ...DEFAULT_TOWNSHIPS])]
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 隐患点建档的页面渲染提示：能不能改、不能改的原因、当前允许的动作，都由服务层算好，
// 页面只负责展示，不做业务判断。
export type HazardPermission = {
  editable: boolean
  reason: string
  allowedActions: string[]
}

export function hazardPermission(row: EntryRow): HazardPermission {
  const meta = moduleMeta(HAZARD_KEY)
  const township = String(row[HAZARD_TOWNSHIP_FIELD] ?? '').trim()
  if (township === '') {
    return { editable: false, reason: '所在乡镇为空，按无效值处理，退回补填', allowedActions: [] }
  }
  const duty = currentDutyTownship()
  if (duty === '' || duty !== township) {
    const dutyLabel = duty === '' ? '未登记乡镇' : duty
    return { editable: false, reason: `只读：归属${township}，当前值班${dutyLabel}`, allowedActions: [] }
  }
  const current = String(row.status)
  const allowedActions = meta.actions.filter((action) => expectedFromStatus(meta, action) === current)
  if (allowedActions.length === 0) {
    return { editable: true, reason: '已办结，状态只读', allowedActions: [] }
  }
  return { editable: true, reason: '', allowedActions }
}

// 动作的前置状态：流转目标在状态序列里的前一位，保证只能顺向推进。
function expectedFromStatus(meta: ModuleMeta, action: string): string {
  const target = meta.actionTargets[action]
  const targetIndex = meta.statuses.indexOf(target)
  return targetIndex > 0 ? meta.statuses[targetIndex - 1] : ''
}

function runHazardAction(meta: ModuleMeta, rows: EntryRow[], index: number, action: string, target: string): ActionResult {
  const row = rows[index]
  const code = String(row[HAZARD_CODE_FIELD] ?? `#${row.id}`)
  // 管辖乡镇为空按无效值处理，退回重填。
  const township = String(row[HAZARD_TOWNSHIP_FIELD] ?? '').trim()
  if (township === '') {
    return { ok: false, message: `隐患点${code}的所在乡镇为空，按无效值处理：请退回补填管辖乡镇后再${action}` }
  }
  // 管辖收口：只有归属乡镇的值班人员能改，跨乡镇一律挡下并写清原因。
  const duty = currentDutyTownship()
  if (duty === '') {
    return { ok: false, message: `当前值班未登记所在乡镇，无法核验隐患点${code}的管辖关系，${action}被拒` }
  }
  if (duty !== township) {
    return {
      ok: false,
      message: `跨乡镇${action}被拒：隐患编号${code}归属${township}，当前值班乡镇是${duty}，只能由${township}的值班人员操作；管辖乡镇与灾害类型冲突时以所在乡镇为准，灾害类型（${String(row['灾害类型'] ?? '') || '未填'}）不影响权限判定`,
    }
  }
  // 状态机：只能沿 待核查 → 建档中 → 重点防范 → 已消除 顺向推进。
  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `隐患点${code}已经是「${target}」，本次按重复提交处理：不重复建档，也不重复写预警台账` }
  }
  const from = expectedFromStatus(meta, action)
  if (current !== from) {
    return {
      ok: false,
      message: `隐患点${code}当前状态「${current}」不能执行「${action}」：状态只能沿 ${meta.statuses.join(' → ')} 顺向推进，需先到达「${from}」`,
    }
  }
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== meta.statuses[meta.statuses.length - 1],
    abnormal: false,
    隐患状态: target,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(HAZARD_KEY, next)
  // 提交收尾同步预警发布台账：列入重点防范后，台账里添上重点户。
  const ledgerNote = target === '重点防范' ? syncWarningLedger(updated) : ''
  return { ok: true, message: `隐患点${code}已${action}，当前状态「${target}」${ledgerNote}` }
}

// 预警发布台账同步：按 WARN-<隐患编号> 幂等写入，重复提交不会多出第二条记录。
function syncWarningLedger(hazard: EntryRow): string {
  const rows = listRows(WARNING_KEY)
  const ledgerCode = `WARN-${String(hazard[HAZARD_CODE_FIELD] ?? hazard.id)}`
  const households = `${String(hazard[HAZARD_TOWNSHIP_FIELD])}重点户${hazard['威胁户数']}户${hazard['威胁人数']}人`
  const today = new Date().toISOString().slice(0, 10)
  const existing = rows.findIndex((row) => row['预警编号'] === ledgerCode)
  if (existing >= 0) {
    const merged: EntryRow = {
      ...rows[existing],
      发布对象: households,
      预警级别: '重点防范',
      发布渠道: '隐患点建档同步',
      发布时间: today,
    }
    const next = [...rows]
    next[existing] = merged
    saveRows(WARNING_KEY, next)
    return `；预警台账已存在${ledgerCode}，本次只刷新重点户信息，未重复建档`
  }
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const entry: EntryRow = {
    id,
    status: '待发布',
    pending: true,
    abnormal: false,
    预警编号: ledgerCode,
    发布对象: households,
    预警级别: '重点防范',
    触发雨量: '—',
    发布时间: today,
    发布渠道: '隐患点建档同步',
    解除时间: '',
    预警状态: '待发布',
  }
  saveRows(WARNING_KEY, [...rows, entry])
  return `；已同步预警发布台账（${ledgerCode}，${households}）`
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (key === HAZARD_KEY) {
    return runHazardAction(meta, rows, index, action, target)
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
