import { defineStore } from 'pinia'

import { currentDutyTownship, setDutyTownship } from '@/data/jurisdiction'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '山地地质灾害隐患巡查与治理工作台',
    // 值班乡镇与数据层共用同一份（data/jurisdiction.ts），各入口取到的所在乡镇一致。
    township: currentDutyTownship(),
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setTownship(label: string) {
      this.township = label.trim()
      setDutyTownship(label)
    },
  },
})
