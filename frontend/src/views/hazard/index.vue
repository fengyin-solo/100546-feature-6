<template>
  <section class="page" data-module="hazard">
    <header class="page-head">
      <div>
        <h2>隐患点建档管理</h2>
        <p class="page-desc">维护隐患点，围绕隐患编号、所在乡镇、灾害类型、坡体规模做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记隐患点</button>
        <button class="btn" type="button" @click="exportRows">导出隐患点建档清单</button>
      </div>
    </header>

    <p class="rule-note">
      当前值班乡镇：<strong>{{ dutyTownship || '未登记' }}</strong>。
      隐患编号归属哪个乡镇，就只有那个乡镇的值班人员能提交核查、列入重点防范、登记消除；跨乡镇提交会被挡下并写明原因。
      管辖乡镇与灾害类型冲突时以管辖乡镇（所在乡镇）为准，灾害类型不参与权限判定；所在乡镇为空按无效值处理，退回重填。
      状态只能沿 待核查 → 建档中 → 重点防范 → 已消除 顺向推进；列入重点防范后自动同步预警发布台账并添上重点户，重复提交不会多出第二条记录。
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="permissionOf(row).editable && permissionOf(row).allowedActions.length">
              <button
                v-for="action in permissionOf(row).allowedActions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="readonly-tag">{{ permissionOf(row).reason || '只读' }}</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无隐患点建档数据，可先登记隐患点</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条隐患点建档记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  currentDutyTownship,
  downloadEntries,
  hazardPermission,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  type HazardPermission,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('hazard')
const columns = ["隐患编号", "所在乡镇", "灾害类型", "坡体规模", "威胁户数", "威胁人数", "发现日期", "隐患状态"]
const statuses = ["待核查", "建档中", "重点防范", "已消除"]
const stats = [{"label": "重点防范隐患点", "value": 0}, {"label": "待核查隐患点", "value": 0}, {"label": "威胁人数合计", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 值班乡镇从会话里取，和服务层管辖校验用的是同一份，页面上看到的就是实际生效的。
const dutyTownship = computed(() => currentDutyTownship())

// 每行的可操作权限由服务层统一判定，页面只渲染结论：能改的给动作按钮，不能改的给只读原因。
const permissions = computed(() => {
  const map = new Map<number, HazardPermission>()
  for (const row of rows.value) {
    map.set(Number(row.id), hazardPermission(row))
  }
  return map
})

function permissionOf(row: EntryRow): HazardPermission {
  return permissions.value.get(Number(row.id)) ?? { editable: false, reason: '只读', allowedActions: [] }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '隐患点登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '隐患点建档列表读取失败'
  }
}

onMounted(reload)
</script>
