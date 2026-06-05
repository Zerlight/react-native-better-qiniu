# Changelog

## 1.0.0 - 2026-06-05

### Added

- Added the task-first upload API with `createUploadTask()`, task-scoped progress, `task.start()`, and `task.cancel()`.
- Added `tokenProvider` so upload tokens can be supplied by a recommended async provider when per-upload options omit `token`.
- Added structured `UploadResult` and `QiniuUploadError` objects for new task-based uploads.
- Added explicit lifecycle factories: `Qiniu.shared(config)` and `Qiniu.create(config)`.

### Changed

- Upload cancellation is identified by local `uploadId` instead of the Qiniu object `key`.
- Qiniu SDK builder-style options can now be grouped under `advanced`, with legacy top-level advanced fields still accepted.
- Example credentials are collected at runtime instead of being hardcoded in source.

### Deprecated

- Deprecated `new Qiniu(config)` in favor of `Qiniu.shared(config)` or `Qiniu.create(config)`.
- Deprecated `qiniu.upload()` and `qiniu.cancel(uploadId)` as migration bridges to the task API.

### Fixed

- Default Qiniu configuration now uses AutoZone without requiring an explicit `zone`.
- Locked official Qiniu native SDK dependencies to 8.9.2.
