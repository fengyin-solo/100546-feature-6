import { currentDutyTownship } from '@/data/jurisdiction'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const HAZARD_KEY = 'hazard'
const WARNING_KEY = 'warning'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
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

// 隐患点建档按管辖收口：隐患编号归哪个乡镇，就只有那个乡镇的值班人员能改。
// 返回 null 表示放行，否则就是被拒的原因，原样展示给操作人。
function hazardJurisdictionProblem(row: EntryRow, action: string): string | null {
  const code = String(row['隐患编号'] ?? row.id)
  const owner = String(row['所在乡镇'] ?? '').trim()
  if (!owner) {
    return `隐患点「${code}」的管辖乡镇为空，按无效值处理，请退回重填后再${action}`
  }
  const duty = currentDutyTownship().trim()
  if (!duty) {
    return `当前值班的管辖乡镇为空，按无效值处理，请退回重填后再${action}`
  }
  if (duty !== owner) {
    const readonly =
      String(row.status) === '待核查'
        ? ''
        : `；该记录状态已推进至「${String(row.status)}」，对「${duty}」只读`
    return `隐患点「${code}」归「${owner}」管辖，当前值班为「${duty}」，跨乡镇${action}不予受理${readonly}`
  }
  return null
}

// 隐患点状态只能顺着 待核查→建档中→重点防范→已消除 推进，不许跳步、不许回头。
function hazardSequenceProblem(row: EntryRow, action: string, target: string, meta: ModuleMeta): string | null {
  const current = String(row.status)
  const from = meta.statuses.indexOf(current)
  const to = meta.statuses.indexOf(target)
  if (from < 0 || to !== from + 1) {
    return `隐患点状态只能按「${meta.statuses.join('→')}」顺序推进，当前「${current}」不能执行「${action}」`
  }
  return null
}

// 列入重点防范的结果同步到预警发布台账，台账里添上重点户；
// 同一隐患编号只落一条台账，重复提交不会多出第二条记录。
function syncWarningLedger(hazard: EntryRow): string {
  const code = String(hazard['隐患编号'] ?? '').trim()
  const owner = String(hazard['所在乡镇'] ?? '').trim()
  const target = `${owner}·${code}`
  const rows = listRows(WARNING_KEY)
  const existing = rows.find((row) => String(row['发布对象']) === target)
  if (existing) {
    return `预警发布台账已有「${target}」的记录（${String(existing['预警编号'])}），未重复添加`
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const ledger: EntryRow = {
    id: nextId,
    status: '待发布',
    pending: true,
    abnormal: false,
    预警编号: `WARN-${String(nextId).padStart(4, '0')}`,
    发布对象: target,
    预警级别: '重点防范',
    重点户: hazard['威胁户数'] ?? '',
    触发雨量: '',
    发布时间: new Date().toISOString().slice(0, 10),
    发布渠道: '隐患点建档同步',
    解除时间: '',
    预警状态: '待发布',
  }
  saveRows(WARNING_KEY, [...rows, ledger])
  return `已同步预警发布台账（${String(ledger['预警编号'])}，重点户 ${String(ledger['重点户']) || '—'}）`
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
    const problem = hazardJurisdictionProblem(rows[index], action)
    if (problem) {
      return { ok: false, message: problem }
    }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  if (key === HAZARD_KEY) {
    const problem = hazardSequenceProblem(rows[index], action, target, meta)
    if (problem) {
      return { ok: false, message: problem }
    }
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
  let message = `${meta.entity}已${action}，当前状态「${target}」`
  if (key === HAZARD_KEY && target === '重点防范') {
    message = `${message}；${syncWarningLedger(updated)}`
  }
  return { ok: true, message }
}

export type HazardRegistration = {
  隐患编号: string
  灾害类型: string
  坡体规模: string
  威胁户数: string
  威胁人数: string
  发现日期: string
}

// 隐患点登记建档：所在乡镇取当前值班乡镇（各入口同一份），重复提交同一隐患编号
// 不会多出第二条记录；管辖乡镇为空按无效值退回重填。
export function registerHazard(input: HazardRegistration): ActionResult {
  const meta = moduleMeta(HAZARD_KEY)
  const code = input.隐患编号.trim()
  if (!code) {
    return { ok: false, message: '隐患编号为空，按无效值处理，请退回重填' }
  }
  const duty = currentDutyTownship().trim()
  if (!duty) {
    return { ok: false, message: '管辖乡镇为空，按无效值处理，请退回重填后再登记' }
  }
  const rows = listRows(HAZARD_KEY)
  const existing = rows.find((row) => String(row['隐患编号']).trim() === code)
  if (existing) {
    return {
      ok: false,
      message: `隐患编号「${code}」已建档，归「${String(existing['所在乡镇'])}」管辖，当前状态「${String(existing.status)}」，重复提交不再生成第二条记录`,
    }
  }
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const created: EntryRow = {
    id: nextId,
    status: meta.statuses[0],
    pending: true,
    abnormal: false,
    隐患编号: code,
    所在乡镇: duty,
    灾害类型: input.灾害类型.trim(),
    坡体规模: input.坡体规模.trim(),
    威胁户数: input.威胁户数.trim(),
    威胁人数: input.威胁人数.trim(),
    发现日期: input.发现日期.trim(),
    隐患状态: meta.statuses[0],
  }
  saveRows(HAZARD_KEY, [...rows, created])
  return { ok: true, message: `隐患点「${code}」已建档，归「${duty}」管辖，当前状态「${meta.statuses[0]}」` }
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
