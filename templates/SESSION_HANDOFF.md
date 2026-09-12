# 会话交接

handoff_id：  
work_item_id：  
captured_at：  
source_state_revision：  
交接人：

## 工作区身份

- repository：
- worktree：
- branch：
- HEAD：
- dirty files / untracked：
- target environment：

> 本文件是临时快照，不直接覆盖 WORK_ITEM。恢复后核对身份与状态版本，把有效变化合并回 WORK_ITEM，再归档本文件。

## 当前结论

## 已完成及证据链接

## 未完成与原因

## 最后验证

| acceptance_id | procedure | result | artifact | observed_at | limitations |
|---|---|---|---|---|---|

## 下一原子动作

## 风险与禁止事项

## 按需读取的精确路径#fragment

## 恢复核对

- [ ] work_item_id 与工作区身份一致
- [ ] WORK_ITEM state_revision 未被更新版本取代
- [ ] 旧验证仍与当前 HEAD/环境匹配；否则已标记失效
- [ ] 有效变化已合并回 WORK_ITEM，并递增状态版本
