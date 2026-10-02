// 管辖乡镇的唯一数据源：页面头部、隐患点建档、预警发布台账、状态流转校验都从这里
// 取所在乡镇，保证各入口拿到的是同一份，不允许各页面各自再存一份。
//
// 管辖权判定规则（管辖乡镇与灾害类型冲突时以谁为准，写死在这里）：
//   1. 隐患点的管辖权只看档案上的「所在乡镇」，即隐患编号归属的乡镇；
//      建档时取登记人当前的值班乡镇，落档后不再改写，别的乡镇无权变动。
//   2. 灾害类型只作业务分类，不参与管辖判定。
//   3. 按灾害类型推算的管辖方向与档案「所在乡镇」不一致时，一律以「所在乡镇」为准。
//   4. 管辖乡镇为空一律按无效值处理：相关提交与流转直接退回，要求重填。
export const TOWNSHIPS: string[] = ['青溪镇', '白石乡', '龙潭镇']

let dutyTownship = TOWNSHIPS[0]

export function currentDutyTownship(): string {
  return dutyTownship
}

export function setDutyTownship(value: string): void {
  dutyTownship = value.trim()
}
