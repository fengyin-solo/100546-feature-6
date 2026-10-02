import { defineStore } from 'pinia'

import { DEFAULT_TOWNSHIPS } from '@/data/townships'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '山地地质灾害隐患巡查与治理工作台',
    // 当前值班人员的所在乡镇：隐患点建档按管辖收口的唯一身份依据，
    // 表头展示、隐患页权限提示、服务层拦截都从这一个字段取。
    township: DEFAULT_TOWNSHIPS[0],
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTownship(name: string) {
      this.township = name.trim()
    },
  },
})
