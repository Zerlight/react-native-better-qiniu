# react-native-better-qiniu

A React Native [Turbo Module](https://reactnative.dev/docs/turbo-native-modules-introduction) for [Qiniu Cloud Kodo](https://developer.qiniu.com/kodo) object storage, using the latest native SDKs for high-performance uploads.

This library provides a modern, promise-based API for uploading files from your React Native application to Qiniu's object storage, with support for progress tracking, cancellation, and resumable uploads.

[](https://www.google.com/search?q=https://www.npmjs.com/package/react-native-better-qiniu)
[](https://www.google.com/search?q=https://www.npmjs.com/package/react-native-better-qiniu)

-----

## Installation

```sh
npm install react-native-better-qiniu
# --- or ---
yarn add react-native-better-qiniu
# --- or ---
pnpm add react-native-better-qiniu
```

After installing the package, you need to install the native dependencies for iOS:

```sh
cd ios && pod install
```

## Usage

Here is a basic example of how to initialize the client and upload a file with the task API.

```javascript
import { Qiniu, QiniuUploadError } from 'react-native-better-qiniu';

const qiniu = Qiniu.shared({
  zone: 'auto', // Automatically select the best upload zone
  useConcurrentResumeUpload: true,
  putThreshold: 4 * 1024 * 1024, // Use resumable upload for files larger than 4MB
  tokenProvider: async ({ key }) => {
    // Fetch an upload token from your server. Never generate tokens in the app.
    const response = await fetch(`/upload-token?key=${encodeURIComponent(key)}`);
    const { token } = await response.json();
    return token;
  },
});

let activeTask = null;

const handleUpload = async () => {
  const task = qiniu.createUploadTask({
    filePath: '/path/to/your/local/file.jpg', // A direct, URI-decoded file path
    key: `uploads/image-${Date.now()}.jpg`,
  });
  activeTask = task;

  const subscription = task.onProgress((event) => {
    const percent = Math.round(event.percent * 100);
    console.log(`Upload Progress: ${percent}%`);
  });

  try {
    const result = await task.start();
    console.log('Upload successful!', result.hash, result.raw);
  } catch (error) {
    if (error instanceof QiniuUploadError && error.isCancelled) {
      console.log('Upload cancelled');
    } else {
      console.error('Upload failed.', error);
    }
  } finally {
    subscription.remove();
    activeTask = null;
  }
};

const handleCancel = () => {
  activeTask?.cancel();
};
```

## Example

*NPM package does not include the example app. If you need it, please clone the GitHub repository and run the example app from there.*

Under the `example` directory, you can find a complete React Native application that demonstrates how to use this library. It includes:
- A simple UI for selecting a file and uploading it to Qiniu.
- Progress tracking and cancellation functionality.

To run the example app, please follow the instructions in `example/README.md`.

-----

## API Reference

### `Qiniu.shared(config: QiniuConfig)`

Creates a JS client and reuses a cached native upload manager for identical native configuration.

### `Qiniu.create(config: QiniuConfig)`

Creates a JS client with a new native upload manager, even when the native configuration matches an existing shared instance.

### `new Qiniu(config: QiniuConfig)`

Deprecated compatibility constructor. Prefer `Qiniu.shared(config)` or `Qiniu.create(config)` so lifecycle intent is explicit.

#### `QiniuConfig` (Interface)

| Property | Type | Description |
| --- | --- | --- |
| `zone` | `'auto'` \| `ZoneRegionId` \| `ZoneCustomDomains` \| `ZoneCustomUcServers` | The upload zone configuration. |
| `putThreshold` | `number` | The file size threshold in bytes for triggering resumable (chunked) upload. |
| `useConcurrentResumeUpload` | `boolean` | Enables concurrent uploading of multiple chunks for faster resumable uploads. |
| `resumeUploadVersion` | `'v1'` \| `'v2'` | Specifies the version of the resumable upload protocol. |
| `useHttps` | `boolean` | Whether to use HTTPS for uploads. |
| `tokenProvider` | `(input) => string \| Promise<string>` | Returns an upload token for a task when the task options do not include `token`. |
| `advanced` | `QiniuAdvancedConfig` | Less common SDK-builder options. |

Legacy top-level advanced fields such as `chunkSize`, `retryMax`, and `timeoutInterval` are still accepted but deprecated. When both are present, `advanced` wins.

#### `QiniuAdvancedConfig` (Interface)

| Property | Type | Description |
| --- | --- | --- |
| `accelerateUploading` | `boolean` | Enables global acceleration. Requires server-side and bucket configuration. |
| `chunkSize` | `number` | The size of each chunk in bytes for resumable uploads. |
| `retryMax` | `number` | The maximum number of times to retry a failed chunk. |
| `retryInterval` | `number` | Retry interval in seconds. |
| `timeoutInterval` | `number` | Network timeout in seconds for each request. |
| `allowBackupHost` | `boolean` | Allows backup upload hosts. |
| `concurrentTaskCount` | `number` | Concurrent task count for multipart upload. |

### `qiniu.createUploadTask(options: UploadOptions)`

Creates an upload task without starting it.

#### `UploadTask`

| Member | Type | Description |
| --- | --- | --- |
| `uploadId` | `string` | Local task identifier. Generated automatically when omitted. |
| `key` | `string` | The Qiniu object key. |
| `status` | `'idle' \| 'uploading' \| 'success' \| 'error' \| 'cancelled'` | Current task status. |
| `onProgress(listener)` | `() => { remove(): void }` | Subscribes to progress for this task. |
| `start()` | `() => Promise<UploadResult>` | Starts the upload. Calling it more than once returns the same promise. |
| `cancel()` | `() => void` | Cancels this task. |

### `qiniu.upload(options: UploadOptions)`

Deprecated compatibility wrapper. It creates a task internally and resolves with `UploadResult.raw` so existing callers continue receiving the raw JSON string.

#### `UploadOptions` (Interface)

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `uploadId` | `string` | No | A local identifier for this upload task. Generated automatically when omitted. |
| `filePath` | `string` | Yes | The absolute local file path. **Note:** Must be a raw path, not a `file://` URI. Decode URI-encoded paths before passing. |
| `key` | `string` | Yes | The destination key (filename) for the file in your Qiniu bucket. |
| `token` | `string` | No | A valid upload token. Overrides `QiniuConfig.tokenProvider` when present. |
| `onProgress` | `(event: UploadProgressEvent) => void` | No | Compatibility progress callback. Prefer `task.onProgress()`. |

### `qiniu.cancel(uploadId: string)`

Deprecated compatibility wrapper. Prefer `UploadTask.cancel()`.

### `qiniu.destroy()`

Decrements the reference count for the native instance. When all JS instances sharing the same configuration are destroyed, the underlying native instance is removed to free up resources.

### `UploadResult` (Interface)

| Property | Type | Description |
| --- | --- | --- |
| `uploadId` | `string` | Local task identifier. |
| `key` | `string` | The Qiniu object key. |
| `statusCode` | `number` | Native SDK status code. |
| `requestId` | `string` | Qiniu request ID when available. |
| `host` | `string` | Upload host when available. |
| `hash` | `string` | Parsed `hash` from the Qiniu response when available. |
| `fsize` | `number` | Parsed `fsize` from the Qiniu response when available. |
| `bucket` | `string` | Parsed `bucket` from the Qiniu response when available. |
| `response` | `object` | Parsed response body. |
| `raw` | `string` | Raw JSON response string. |

### `QiniuUploadError`

| Property | Type | Description |
| --- | --- | --- |
| `code` | `string` | `TOKEN_MISSING`, `UPLOAD_ERROR`, `UPLOAD_CANCELLED`, or a native error code. |
| `message` | `string` | Human-readable error message. |
| `statusCode` | `number` | Native SDK status code when available. |
| `requestId` | `string` | Qiniu request ID when available. |
| `isCancelled` | `boolean` | Whether the upload was cancelled. |
| `raw` | `unknown` | Raw native error metadata when available. |

### `ZoneRegionId` (Enum)

An enum of predefined zone IDs for different [Qiniu regions](https://developer.qiniu.com/kodo/1671/region-endpoint-fq).

### `ZoneCustomDomains` & `ZoneCustomUcServers` (Classes)

Classes used to provide custom domains for fixed zones or custom UC servers for auto zones.

```javascript
import { ZoneCustomDomains, ZoneCustomUcServers, Qiniu } from 'react-native-better-qiniu';

// Example for custom domains
const domainZone = new ZoneCustomDomains(['upload1.your-domain.com','upload2.your-domain.com']);
const qiniu1 = new Qiniu({ zone: domainZone });

// Example for custom UC servers
const ucZone = new ZoneCustomUcServers(['uc1.your-domain.com', 'uc2.your-domain.com']);
const qiniu2 = new Qiniu({ zone: ucZone });
```

### `UploadProgressEvent` (Interface)

| Property | Type | Description |
| --- | --- | --- |
| `uploadId` | `string` | The local identifier of the upload task. |
| `key` | `string` | The key of the file being uploaded. |
| `percent` | `number` | The upload progress percentage (0 to 1). |

### Platform Capability Notes

The common config fields are intended to behave consistently on Android and iOS. `advanced` fields are passed through to the official native SDK builders; support depends on each SDK version. Global acceleration requires Qiniu server-side and bucket configuration on both platforms.

-----

## License

This project is licensed under the **MIT License**.

## Acknowledgments

This library was built upon the work of Qiniu's official native SDKs and inspired by previous community libraries.

  - [Qiniu Android SDK](https://github.com/qiniu/android-sdk)
  - [Qiniu Objective-C SDK](https://github.com/qiniu/objc-sdk)
  - [@react-native-hero/qiniu](https://github.com/react-native-hero/qiniu)

-----

Made with ❤️ by Zerlight using [create-react-native-library](https://github.com/callstack/react-native-builder-bob)
