import { NativeModules, Platform } from 'react-native';
import uuid from 'react-native-uuid';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';

const LINKING_ERROR =
  `The package 'react-native-better-qiniu' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

interface QiniuNativeModule {
  configure(instanceId: string, options: QiniuFullConfig): void;
  upload(instanceId: string, options: NativeUploadOptions): Promise<any>;
  cancel(uploadId: string): void;
  destroy(instanceId: string): void;

  readonly onQNUpProgressed: EventEmitter<UploadProgressEvent>;
}

const QiniuModule: QiniuNativeModule = NativeModules.BetterQiniu
  ? (NativeModules.BetterQiniu as QiniuNativeModule)
  : {
      configure: () => {
        throw new Error(LINKING_ERROR);
      },
      upload: () => {
        return Promise.reject(new Error(LINKING_ERROR));
      },
      cancel: () => {
        throw new Error(LINKING_ERROR);
      },
      destroy: () => {
        throw new Error(LINKING_ERROR);
      },
      onQNUpProgressed: () => {
        throw new Error(LINKING_ERROR);
      },
    };

const instanceCache = new Map<string, string>();
const refCounts = new Map<string, number>();

export interface QiniuTokenProviderInput {
  uploadId: string;
  key: string;
  filePath: string;
}

export type QiniuTokenProvider = (
  input: QiniuTokenProviderInput
) => string | Promise<string>;

export interface QiniuAdvancedConfig {
  /**
   * Only valid when using AutoZone. Please note that configurations are required for both Qiniu server-side SDK and Qiniu bucket settings.
   */
  accelerateUploading?: boolean;
  /**
   * In bytes. e.g., 4 * 1024 * 1024 for 4MB
   */
  chunkSize?: number;
  retryMax?: number;
  retryInterval?: number;
  timeoutInterval?: number;
  allowBackupHost?: boolean;
  concurrentTaskCount?: number;
}

/**
 * Configuration for a Qiniu instance.
 * Mirrors the native SDK options.
 * @see https://developer.qiniu.com/kodo/1236/android
 * @see https://developer.qiniu.com/kodo/1240/objc
 */
export interface QiniuConfig {
  /**
   * `ZoneRegionId` and `ZoneCustomDomains` will use FixedZone. `ZoneCustomUcServers` and `'auto'` will use AutoZone.
   *
   * When set to auto, the SDK will automatically select the best upload zone based on the current network conditions.
   */
  zone?: ZoneRegionId | ZoneCustomDomains | ZoneCustomUcServers | 'auto';
  /**
   * In bytes. e.g., 4 * 1024 * 1024 for 4MB
   */
  putThreshold?: number;
  useConcurrentResumeUpload?: boolean;
  resumeUploadVersion?: 'v1' | 'v2';
  useHttps?: boolean;
  tokenProvider?: QiniuTokenProvider;
  advanced?: QiniuAdvancedConfig;
  /**
   * Only valid when using AutoZone. Please note that configurations are required for both Qiniu server-side SDK and Qiniu bucket settings.
   * @deprecated Use `advanced.accelerateUploading` instead.
   */
  accelerateUploading?: boolean;
  /**
   * If true, a new instance will be created no matter if an existing instance with the same configuration exists.
   *
   * The library will not automatically create a new instance if an existing one with the same configuration exists.
   * @deprecated Use `Qiniu.create(config)` instead.
   */
  enforceNewInstance?: boolean;
  /**
   * In bytes. e.g., 4 * 1024 * 1024 for 4MB
   * @deprecated Use `advanced.chunkSize` instead.
   */
  chunkSize?: number;
  /** @deprecated Use `advanced.retryMax` instead. */
  retryMax?: number;
  /** @deprecated Use `advanced.retryInterval` instead. */
  retryInterval?: number;
  /** @deprecated Use `advanced.timeoutInterval` instead. */
  timeoutInterval?: number;
  /** @deprecated Use `advanced.allowBackupHost` instead. */
  allowBackupHost?: boolean;
  /** @deprecated Use `advanced.concurrentTaskCount` instead. */
  concurrentTaskCount?: number;
}

interface QiniuFullConfig {
  domains?: string[];
  ucServers?: string[];
  zone?: string;
  putThreshold?: number;
  useConcurrentResumeUpload?: boolean;
  resumeUploadVersion?: 'v1' | 'v2';
  accelerateUploading?: boolean;
  chunkSize?: number;
  retryMax?: number;
  retryInterval?: number;
  timeoutInterval?: number;
  useHttps?: boolean;
  allowBackupHost?: boolean;
  concurrentTaskCount?: number;
}

interface NormalizedQiniuConfig {
  enforceNewInstance: boolean;
  fullConfig: QiniuFullConfig;
  tokenProvider?: QiniuTokenProvider;
}

const compactConfig = <T extends object>(config: T) => {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
};

/**
 * Represents the predefined regions for Qiniu upload zones.
 * This is not recommended. Only for development or testing purposes.
 *
 * @example
 * const qiniu = new Qiniu({
 *   zoneType: 'fixed',
 *   zone: ZoneRegionId.Z0,
 * });
 */
export enum ZoneRegionId {
  Z0 = 'z0', // 华东-浙江
  CN_EAST_2 = 'cn-east-2', // 华东-浙江2
  Z1 = 'z1', // 华北-河北
  Z2 = 'z2', // 华南-广东
  CN_NORTHWEST_1 = 'cn-northwest-1', // 西北-陕西1
  NA0 = 'na0', // 北美-洛杉矶
  AS0 = 'as0', // 亚太-新加坡（原东南亚）
  AP_SOUTHEAST_2 = 'ap-southeast-2', // 亚太-河内
  AP_SOUTHEAST_3 = 'ap-southeast-3', // 亚太-胡志明
}

/**
 * Represents a zone configuration with a list of custom upload domains.
 * Use this when you need to specify your own upload domains instead of using one of the predefined regions.
 * Remember it is recommended to **distribute domains from the service server**, not hardcoded.
 *
 * @example
 * const customZone = new ZoneCustomDomains(['upload.example.com', 'upload2.example.com']);
 * const qiniu = new Qiniu({
 *   zoneType: 'fixed',
 *   zone: customZone,
 * });
 */
export class ZoneCustomDomains {
  readonly domains: string[];

  /**
   * Creates an instance of a custom upload domains.
   * @param domains An array of custom domain strings. Must not be empty.
   */
  constructor(domains: string[]) {
    if (!domains || domains.length === 0) {
      throw new Error('Custom upload domains must have at least one domain.');
    }
    this.domains = domains;
  }
}

/**
 * Represents a zone configuration with custom UC servers.
 * Use this when you need to specify your own UC servers instead of using public cloud services.
 *
 * @example
 * const customUcServers = new ZoneCustomUcServers(['uc1.example.com', 'uc2.example.com']);
 * const qiniu = new Qiniu({
 *   zoneType: 'auto',
 *   zone: customUcServers,
 * });
 */
export class ZoneCustomUcServers {
  readonly ucServers: string[];

  /**
   * Creates an instance of a custom zone with custom UC servers.
   * @param ucServers An array of custom UC server strings. Must not be empty.
   */
  constructor(ucServers: string[]) {
    if (!ucServers || ucServers.length === 0) {
      throw new Error('Custom UC servers must have at least one server.');
    }
    this.ucServers = ucServers;
  }
}

export interface UploadProgressEvent {
  uploadId: string;
  key: string;
  /**
   * The current upload progress as a percentage.
   * This value ranges from 0.0 to 1.0.
   */
  percent: number;
}

export type UploadTaskStatus =
  | 'idle'
  | 'uploading'
  | 'success'
  | 'error'
  | 'cancelled';

export type UploadProgressListener = (
  event: UploadProgressEvent
) => void;

export interface UploadTaskSubscription {
  remove(): void;
}

export interface UploadOptions {
  /**
   * A local identifier for this upload task. Use this value to filter progress
   * and cancel the task, especially when multiple uploads use the same Qiniu key.
   */
  uploadId?: string;
  /**
   * The local file path to upload.
   *
   * **Note:** Please ensure it is NOT a `file://` URI and remember to decode the URI in case of non-ASCII or special characters.
   * @example
   * '/var/foo/bar'
   *
   * @example
   * decodeURIComponent('file:///var/%E5%A4%A2'.replace('file://', ''));
  */
  filePath: string;
  key: string;
  token?: string;
  onProgress?: (event: UploadProgressEvent) => void;
}

interface NativeUploadOptions {
  uploadId: string;
  filePath: string;
  key: string;
  token: string;
  hasProgressListener: boolean;
}

export class UploadTask {
  readonly uploadId: string;
  readonly key: string;

  private readonly qiniu: Qiniu;
  private readonly options: Omit<UploadOptions, 'uploadId' | 'onProgress'>;
  private readonly listeners = new Set<UploadProgressListener>();
  private uploadPromise: Promise<any> | null = null;

  status: UploadTaskStatus = 'idle';

  constructor(qiniu: Qiniu, options: UploadOptions) {
    this.qiniu = qiniu;
    this.uploadId = options.uploadId ?? String(uuid.v4());
    this.key = options.key;
    this.options = {
      filePath: options.filePath,
      key: options.key,
      token: options.token,
    };

    if (options.onProgress) {
      this.onProgress(options.onProgress);
    }
  }

  onProgress(listener: UploadProgressListener): UploadTaskSubscription {
    this.listeners.add(listener);

    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  start(): Promise<any> {
    if (this.uploadPromise) {
      return this.uploadPromise;
    }

    this.status = 'uploading';
    this.uploadPromise = this.qiniu
      .startUploadTask(this, this.options, (event) => {
        this.listeners.forEach((listener) => {
          listener(event);
        });
      })
      .then((result) => {
        this.status = 'success';
        return result;
      })
      .catch((error) => {
        if (this.status !== 'cancelled') {
          this.status = 'error';
        }
        throw error;
      });

    return this.uploadPromise;
  }

  cancel(): void {
    this.status = 'cancelled';
    this.qiniu.cancel(this.uploadId);
  }
}

export class Qiniu {
  private readonly instanceId: string;
  private readonly instanceConfigKey: string;
  private readonly tokenProvider?: QiniuTokenProvider;

  static shared(config: QiniuConfig = {}): Qiniu {
    return new Qiniu(config);
  }

  static create(config: QiniuConfig = {}): Qiniu {
    return new Qiniu(config, { forceNewInstance: true });
  }

  /**
   * Creates and configures a new Qiniu client instance.
   * @param config Configuration options for this instance.
   * @deprecated Prefer `Qiniu.shared(config)` or `Qiniu.create(config)` to make
   * lifecycle intent explicit.
   */
  constructor(
    config: QiniuConfig = {},
    options: { forceNewInstance?: boolean } = {}
  ) {
    const normalizedConfig = Qiniu.normalizeConfig(config);
    const fullConfig = normalizedConfig.fullConfig;
    const forceNewInstance =
      options.forceNewInstance ?? normalizedConfig.enforceNewInstance;

    this.instanceConfigKey = JSON.stringify(fullConfig);
    this.tokenProvider = normalizedConfig.tokenProvider;
    if (instanceCache.has(this.instanceConfigKey) && !forceNewInstance) {
      this.instanceId = instanceCache.get(this.instanceConfigKey)!;
      refCounts.set(this.instanceId, (refCounts.get(this.instanceId) || 0) + 1);
    } else {
      this.instanceId = uuid.v4();
      if (!forceNewInstance) {
        instanceCache.set(this.instanceConfigKey, this.instanceId);
      }
      refCounts.set(this.instanceId, 1);
      QiniuModule.configure(this.instanceId, fullConfig);
    }
  }

  private static normalizeConfig(config: QiniuConfig): NormalizedQiniuConfig {
    const {
      advanced,
      enforceNewInstance = false,
      tokenProvider,
      zone = 'auto',
      putThreshold,
      useConcurrentResumeUpload,
      resumeUploadVersion,
      useHttps,
      accelerateUploading,
      chunkSize,
      retryMax,
      retryInterval,
      timeoutInterval,
      allowBackupHost,
      concurrentTaskCount,
    } = config;
    const fullConfig: QiniuFullConfig = {
      ...compactConfig({
        putThreshold,
        useConcurrentResumeUpload,
        resumeUploadVersion,
        useHttps,
      }),
      ...compactConfig({
        accelerateUploading,
        chunkSize,
        retryMax,
        retryInterval,
        timeoutInterval,
        allowBackupHost,
        concurrentTaskCount,
      }),
      ...compactConfig(advanced ?? {}),
      zone: undefined,
    };

    switch (typeof zone) {
      case 'string':
        if (Object.values(ZoneRegionId).includes(zone as ZoneRegionId)) {
          fullConfig.zone = zone;
        } else if (zone === 'auto') {
        } else {
          throw new Error(`Invalid zone: ${zone}`);
        }
        break;
      case 'object':
        if (zone instanceof ZoneCustomDomains) {
          fullConfig.domains = zone.domains;
        } else if (zone instanceof ZoneCustomUcServers) {
          fullConfig.ucServers = zone.ucServers;
        } else {
          throw new Error('Invalid zone configuration');
        }
        break;
      default:
        throw new Error(
          "Zone must be 'auto' or an instance of ZoneCustomDomains/ZoneCustomUcServers"
        );
    }

    return {
      enforceNewInstance,
      fullConfig,
      tokenProvider,
    };
  }

  /**
   * Uploads a file using this instance's configuration.
   * @param options The upload options, including the file path and progress callback.
   * @returns A promise that resolves with the server's response upon success.
   * @deprecated Prefer `createUploadTask(options).start()` for task-scoped
   * progress, cancellation, and status.
   */
  upload(options: UploadOptions): Promise<any> {
    return this.createUploadTask(options).start();
  }

  createUploadTask(options: UploadOptions): UploadTask {
    return new UploadTask(this, options);
  }

  startUploadTask(
    task: UploadTask,
    options: Omit<UploadOptions, 'uploadId' | 'onProgress'>,
    onProgress: UploadProgressListener
  ): Promise<any> {
    const progressSubscription = QiniuModule.onQNUpProgressed(
      (event: UploadProgressEvent) => {
        if (event.uploadId === task.uploadId) {
          onProgress(event);
        }
      }
    );

    return this.resolveUploadToken(task, options)
      .then((token) => {
        const nativeOptions: NativeUploadOptions = {
          uploadId: task.uploadId,
          filePath: options.filePath,
          key: options.key,
          token,
          hasProgressListener: true,
        };

        return QiniuModule.upload(this.instanceId, nativeOptions);
      })
      .finally(() => {
        progressSubscription.remove();
      });
  }

  private async resolveUploadToken(
    task: UploadTask,
    options: Omit<UploadOptions, 'uploadId' | 'onProgress'>
  ): Promise<string> {
    if (options.token) {
      return options.token;
    }

    if (this.tokenProvider) {
      return this.tokenProvider({
        uploadId: task.uploadId,
        key: options.key,
        filePath: options.filePath,
      });
    }

    throw new Error('TOKEN_MISSING');
  }

  /**
   * Cancels an ongoing upload. This is a static method as cancellation
   * is tied to the upload ID, not the configuration instance.
   * @param uploadId The unique local ID of the upload to cancel.
   * @deprecated Prefer `UploadTask.cancel()` so cancellation stays scoped to
   * the task instance.
   */
  cancel(uploadId: string): void {
    QiniuModule.cancel(uploadId);
  }

  /**
   * Destroys the native configuration associated with this instance.
   * Call this when the instance is no longer needed to free up native resources.
   */
  destroy(): void {
    const currentCount = refCounts.get(this.instanceId) || 0;
    if (currentCount > 1) {
      refCounts.set(this.instanceId, currentCount - 1);
    } else {
      QiniuModule.destroy(this.instanceId);
      if (instanceCache.get(this.instanceConfigKey) === this.instanceId) {
        instanceCache.delete(this.instanceConfigKey);
      }
      refCounts.delete(this.instanceId);
    }
  }
}
