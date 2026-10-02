/* 隐患点建档管辖规则的冒烟校验：在真实服务层代码上跑一遍关键路径。
 * 运行方式：cd frontend && npm run verify:hazard
 * 覆盖：管辖收口、跨乡镇拦截、空乡镇无效值、状态顺向推进、重复提交幂等、预警台账同步重点户。 */
import { createPinia, setActivePinia } from 'pinia'

setActivePinia(createPinia())

const { useSessionStore } = await import('@/stores/session')
const service = await import('@/api/local-service')

const session = useSessionStore()
let failures = 0

function check(label: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`PASS  ${label}`)
  } else {
    failures += 1
    console.log(`FAIL  ${label}  ${detail}`)
  }
}

// 0. 初始：值班乡镇默认青溪镇，乡镇选项来自同一份来源
check('默认值班乡镇是青溪镇', session.township === '青溪镇', session.township)
const options = service.townshipOptions()
check('乡镇选项包含三个乡镇', ['青溪镇', '石桥镇', '云岭乡'].every((n) => options.includes(n)), options.join('/'))

// 1. 本乡镇顺向推进：待核查 → 建档中 → 重点防范
let r = service.runAction('hazard', 1, '提交核查')
check('青溪镇提交核查 HAZA-0001 成功', r.ok, r.message)
r = service.runAction('hazard', 1, '列入重点防范')
check('青溪镇列入重点防范成功并同步台账', r.ok && r.message.includes('WARN-HAZA-0001') && r.message.includes('重点户'), r.message)

// 2. 台账：重点户已写入，且只有一条
let warnings = service.listEntries('warning').items
let ledger = warnings.filter((w) => w['预警编号'] === 'WARN-HAZA-0001')
check('预警台账新增 WARN-HAZA-0001 一条', ledger.length === 1, `实际 ${ledger.length} 条`)
check('台账发布对象含重点户', ledger.length === 1 && String(ledger[0]['发布对象']).includes('青溪镇重点户12户46人'), String(ledger[0]?.['发布对象']))

// 3. 重复提交：不推进、不重复写台账
r = service.runAction('hazard', 1, '列入重点防范')
check('重复列入重点防范被幂等挡下', !r.ok && r.message.includes('重复提交'), r.message)
warnings = service.listEntries('warning').items
ledger = warnings.filter((w) => w['预警编号'] === 'WARN-HAZA-0001')
check('重复提交后台账仍只有一条', ledger.length === 1, `实际 ${ledger.length} 条`)

// 4. 跨乡镇：石桥镇值班改青溪镇的点要被挡，且写清原因
session.setTownship('石桥镇')
r = service.runAction('hazard', 1, '登记消除')
check('跨乡镇登记消除被拒', !r.ok && r.message.includes('归属青溪镇') && r.message.includes('石桥镇'), r.message)
check('被拒原因写明以所在乡镇为准', r.message.includes('以所在乡镇为准'), r.message)

// 5. 跨乡镇只读权限提示
const perm = service.hazardPermission(service.listEntries('hazard').items.find((row) => row.id === 1)!)
check('跨乡镇行只读且给原因', !perm.editable && perm.reason.includes('青溪镇'), perm.reason)

// 6. 回到青溪镇，顺向登记消除
session.setTownship('青溪镇')
r = service.runAction('hazard', 1, '登记消除')
check('本乡镇登记消除成功', r.ok, r.message)

// 7. 已消除后只读：任何动作都推进不了
r = service.runAction('hazard', 1, '提交核查')
check('已消除后不能回退提交核查', !r.ok && r.message.includes('顺向推进'), r.message)

// 8. 跳级：待核查直接列入重点防范被挡（HAZA-0002 是建档中，先退回演示：用石桥镇身份操作石桥镇的点）
session.setTownship('石桥镇')
r = service.runAction('hazard', 2, '登记消除')
check('建档中不能直接登记消除', !r.ok && r.message.includes('顺向推进'), r.message)
r = service.runAction('hazard', 2, '列入重点防范')
check('石桥镇列入重点防范成功', r.ok, r.message)
warnings = service.listEntries('warning').items
check('台账累计两条同步记录', warnings.filter((w) => String(w['预警编号']).startsWith('WARN-HAZA')).length === 2)

// 9. 所在乡镇为空按无效值处理
const { listRows, saveRows } = await import('@/data/local-store')
const hazardRows = listRows('hazard')
const idx = hazardRows.findIndex((row) => row.id === 3)
hazardRows[idx] = { ...hazardRows[idx], '所在乡镇': '  ' }
saveRows('hazard', hazardRows)
session.setTownship('云岭乡')
r = service.runAction('hazard', 3, '登记消除')
check('所在乡镇为空按无效值退回', !r.ok && r.message.includes('无效值') && r.message.includes('补填'), r.message)

// 10. 值班乡镇为空也无法操作
session.setTownship('')
hazardRows[idx] = { ...hazardRows[idx], '所在乡镇': '云岭乡' }
saveRows('hazard', hazardRows)
r = service.runAction('hazard', 3, '登记消除')
check('值班乡镇为空时被拒', !r.ok && r.message.includes('未登记'), r.message)

// 11. 其他模块不受管辖规则影响（通用流转保持原样）
r = service.runAction('rain', 1, '提交安装')
check('其他模块动作不受影响', r.ok, r.message)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项未通过`)
process.exit(failures === 0 ? 0 : 1)
