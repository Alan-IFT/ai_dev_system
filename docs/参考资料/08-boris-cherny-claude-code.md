# Boris Cherny：We Cut 80% of Claude Code's Prompt

原始视频：[YouTube](https://www.youtube.com/watch?v=qyPCVqFUyDo)  
用户给出的说明名：Building Claude Code；页面实际标题：We Cut 80% of Claude Code's Prompt  
source_id：`SRC-BORIS`  
类型：P1/V1（实践者一手访谈）  
访问核对：2026-09-01

## 可支持的观察

- 模型升级可能使旧 prompt、工具说明和 Harness 补丁变成噪声；应通过消融和验证决定保留什么。
- 与其持续堆 prompt，更重要的是对真实任务建立验证和失败反馈。
- 长时间开放任务与周期性例行任务可使用不同工作方式。

## 在本项目中的落点

- [受控消融](../23-方法库.md#ablation)保留安全/权限边界，逐项移除非安全脚手架并用同一 Case 集比较。
- [Harness 晋升链](../33-评估与演进.md#case-registry)要求 eval、批准、受控发布和线上观察。

## 边界

访谈没有公开完整 Case、对照组、grader 或统计细节；“80%”是具体产品/模型下的结果，不能成为清理比例或周期的硬规则。
