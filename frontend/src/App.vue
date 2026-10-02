<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">山地地质灾害隐患巡查与治理工作台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向隐患点建档、坡体形变与裂缝观测、雨量预警发布、避险搬迁与治理工程验收的山区地质灾害防治工作台。</span>
        <span class="head-user">
          当前值班：{{ store.operator }} · {{ store.shiftLabel }} · 所在乡镇
          <select
            class="township-select"
            :value="store.township"
            @change="store.setTownship(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="name in townshipChoices" :key="name" :value="name">{{ name }}</option>
          </select>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { townshipOptions } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

// 乡镇下拉与隐患点建档的管辖校验取的是同一份数据（local-service 统一出口），
// 在这里选中的乡镇就是全站各入口认定的值班乡镇。
const townshipChoices = ref<string[]>([])

onMounted(() => {
  townshipChoices.value = townshipOptions()
})

const navItems = [{ label: "运营概览", path: "/" }, { label: "隐患点建档", path: "/hazard" }, { label: "边坡形变", path: "/slope" }, { label: "裂缝观测", path: "/crack" }, { label: "雨量站网", path: "/rain" }, { label: "预警发布", path: "/warning" }, { label: "群测群防巡查", path: "/patrol" }, { label: "避险搬迁", path: "/relocate" }, { label: "避险场所", path: "/refuge" }, { label: "应急演练", path: "/drill" }, { label: "治理工程", path: "/project" }, { label: "削坡减载", path: "/cutting" }, { label: "支挡结构", path: "/wall" }, { label: "排水系统", path: "/drainage" }, { label: "警示标识", path: "/signboard" }, { label: "险情上报", path: "/report" }, { label: "专家会商", path: "/consult" }, { label: "隐患核销", path: "/clearance" }, { label: "受威胁对象", path: "/threat" }]
</script>
