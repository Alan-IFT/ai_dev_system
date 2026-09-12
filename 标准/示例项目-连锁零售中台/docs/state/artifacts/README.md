# artifacts · 工具返回原文落点

**不进版本控制**（`.gitignore` 排除本目录除本文件外的一切）。按工作项分目录：`artifacts/<WI>/<序号>-<描述>.txt`。

- 落盘后窗口只留：一句结论、路径、用到的行号范围。
- 证据六字段的"原始证据"指向这里的文件；文件丢了证据就降级为未定——所以 `done` 工作项的证据文件在收口时**归档**到 `artifacts/_archive/<WI>.tar`（对象存储，路径写在工作项里）。
- 30 天未被引用的非归档文件清理。

当前目录（示例）：

```
artifacts/
├─ WI-0142/   e03-staging-v2-fields.txt · e05-replay-diff.txt · e07-prod-receipts-30d.txt · e09-v1-retire.txt · gates-*.txt
├─ WI-0151/   e02-preview-312.txt · e03-multi-barcode.txt · h05-pytest.txt
└─ _archive/  WI-0142.tar（2026-06-08 归档，对象存储 s3://retail-core-evidence/WI-0142.tar）
```
