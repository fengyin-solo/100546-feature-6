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

    <p class="duty-line">
      当前值班乡镇：<strong>{{ dutyTownship || '未指定' }}</strong>。隐患编号归哪个乡镇，就只有那个乡镇的值班人员能核查、列入重点防范与登记消除；跨乡镇提交会被挡下并写明原因。
    </p>

    <form v-if="showCreate" class="create-panel" @submit.prevent="submitCreate">
      <p class="create-hint">
        管辖以「所在乡镇」为准：登记时取当前值班乡镇，落档后不再改写；灾害类型只作业务分类，
        与管辖乡镇冲突时以所在乡镇为准。管辖乡镇为空按无效值处理，提交会被退回重填。
      </p>
      <div class="create-grid">
        <label class="filter-item">
          <span>隐患编号</span>
          <input v-model="createForm.隐患编号" placeholder="如 HAZA-0004" />
        </label>
        <label class="filter-item">
          <span>灾害类型</span>
          <input v-model="createForm.灾害类型" placeholder="如 滑坡" />
        </label>
        <label class="filter-item">
          <span>坡体规模</span>
          <input v-model="createForm.坡体规模" placeholder="如 中型" />
        </label>
        <label class="filter-item">
          <span>威胁户数</span>
          <input v-model="createForm.威胁户数" placeholder="户数" />
        </label>
        <label class="filter-item">
          <span>威胁人数</span>
          <input v-model="createForm.威胁人数" placeholder="人数" />
        </label>
        <label class="filter-item">
          <span>发现日期</span>
          <input v-model="createForm.发现日期" type="date" />
        </label>
        <label class="filter-item">
          <span>所在乡镇（取当前值班乡镇）</span>
          <input :value="dutyTownship || '（空，提交将被退回重填）'" readonly disabled />
        </label>
      </div>
      <div class="create-actions">
        <button class="btn primary" type="submit">提交建档</button>
        <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
      </div>
    </form>

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
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
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
  downloadEntries,
  listEntries,
  moduleMeta,
  registerHazard,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('hazard')
const columns = ["隐患编号", "所在乡镇", "灾害类型", "坡体规模", "威胁户数", "威胁人数", "发现日期", "隐患状态"]
const actions = ["提交核查", "列入重点防范", "登记消除"]
const statuses = ["待核查", "建档中", "重点防范", "已消除"]
const stats = [{"label": "重点防范隐患点", "value": 0}, {"label": "待核查隐患点", "value": 0}, {"label": "威胁人数合计", "value": 0}]

const session = useSessionStore()
// 值班乡镇与页面头部、数据层取的是同一份（data/jurisdiction.ts）。
const dutyTownship = computed(() => session.township)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const showCreate = ref(false)
const emptyForm = { 隐患编号: '', 灾害类型: '', 坡体规模: '', 威胁户数: '', 威胁人数: '', 发现日期: '' }
const createForm = ref({ ...emptyForm })
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  showCreate.value = !showCreate.value
}

function submitCreate() {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = registerHazard(createForm.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  createForm.value = { ...emptyForm }
  showCreate.value = false
  reload()
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
