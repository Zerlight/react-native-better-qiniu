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

Here is a basic example of how to initialize the client and upload a file.

```javascript
import { Qiniu } from 'react-native-better-qiniu';

// 1. Initialize a Qiniu client instance with your desired configuration.
// It's recommended to create and reuse a single instance for the same configuration.
const qiniu = new Qiniu({
  zone: 'auto', // Automatically select the best upload zone
  useConcurrentResumeUpload: true, // Enable concurrent block uploads for faster resumable uploads
  putThreshold: 4 * 1024 * 1024, // Use resumable upload for files larger than 4MB
});

// 2. Define your upload function
const handleUpload = async () => {
  // You must get an upload token from your server for the specific file key.
  // Never generate tokens on the client-side in a production app.
  const uploadToken = '...';

  try {
    const response = await qiniu.upload({
      filePath: '/path/to/your/local/file.jpg', // A direct, URI-decoded file path
      key: `uploads/image-${Date.now()}.jpg`,   // The desired key (filename) on Qiniu
      token: uploadToken,
      onProgress: (event) => {
        const percent = Math.round(event.percent * 100);
        console.log(`Upload Progress: ${percent}%`);
      },
    });

    console.log('Upload successful!', response);
    // The response is a JSON string from Qiniu, you may need to parse it.
    // e.g., const parsedResponse = JSON.parse(response);
    
  } catch (error) {
    console.error('Upload failed or was cancelled.', error);
  }
};

// 3. To cancel an ongoing upload
const handleCancel = () => {
  // Use the same key that was passed to the upload method
  qiniu.cancel(`uploads/image-${Date.now()}.jpg`);
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

### `new Qiniu(config: QiniuConfig)`

Creates and configures a new Qiniu client instance. The library automatically caches instances based on their configuration. If you create a new instance with the exact same configuration, the library will reuse the existing native instance to save resources.

#### `QiniuConfig` (Interface)

`QiniuConfig` is basically a mirror of Qiniu SDK's available configurations. For more detailed descriptions, please go to their official documents.

| Property | Type | Description |
| --- | --- | --- |
| `zone` | `'auto'` \| `ZoneRegionId` \| `ZoneCustomDomains` \| `ZoneCustomUcServers` | The upload zone configuration. |
| `putThreshold` | `number` | The file size threshold in bytes for triggering resumable (chunked) upload. |
| `useConcurrentResumeUpload` | `boolean` | Enables concurrent uploading of multiple chunks for faster resumable uploads. |
| `resumeUploadVersion` | `'v1'` \| `'v2'` | Specifies the version of the resumable upload protocol. |
| `accelerateUploading` | `boolean` | Enables global acceleration. Requires server-side and bucket configuration. |
| `chunkSize` | `number` | The size of each chunk in bytes for resumable uploads. |
| `retryMax` | `number` | The maximum number of times to retry an upload for a failed chunk. |
| `timeoutInterval` | `number` | The network timeout in seconds for each request. |
| `useHttps` | `boolean` | Whether to use HTTPS for uploads. |
| `enforceNewInstance` | `boolean` | If `true`, a new native instance will be created even if another instance with the same configuration already exists. |

- `enforceNewInstance` is added by the library itself, not part of the official SDK configurations.

### `qiniu.upload(options: UploadOptions)`

Uploads a file using the instance's configuration. Returns a `Promise` that resolves with the Qiniu server's response (as a JSON string) upon success, or rejects on failure.

#### `UploadOptions` (Interface)

| Property | Type | Required | Description |
| --- | --- | --- | --- |
| `filePath` | `string` | Yes | The absolute local file path. **Note:** Must be a raw path, not a `file://` URI. Decode URI-encoded paths before passing. |
| `key` | `string` | Yes | The destination key (filename) for the file in your Qiniu bucket. |
| `token` | `string` | Yes | A valid upload token generated from your server. |
| `onProgress` | `(event: UploadProgressEvent) => void` | No | A callback function that receives progress updates for the upload. |

### `qiniu.cancel(key: string)`

Cancels an ongoing upload for a specific `key`.

### `qiniu.destroy()`

Decrements the reference count for the native instance. When all JS instances sharing the same configuration are destroyed, the underlying native instance is removed to free up resources.

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
| `key` | `string` | The key of the file being uploaded. |
| `percent` | `number` | The upload progress percentage (0 to 1). |

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