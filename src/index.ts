import { NativeModules, Platform } from 'react-native';
import type { EventSubscription } from 'react-native';
import uuid from 'react-native-uuid';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';

const LINKING_ERROR =
  `The package 'react-native-better-qiniu' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

interface QiniuNativeModule {
  configure(instanceId: string, options: QiniuFullConfig): void;
  upload(instanceId: string, options: UploadOptions): Promise<any>;
  cancel(key: string): void;
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
  /**
   * Only valid when using AutoZone. Please note that configurations are required for both Qiniu server-side SDK and Qiniu bucket settings.
   */
  accelerateUploading?: boolean;
  /**
   * If true, a new instance will be created no matter if an existing instance with the same configuration exists.
   *
   * The library will not automatically create a new instance if an existing one with the same configuration exists.
   */
  enforceNewInstance?: boolean;
  /**
   * In bytes. e.g., 4 * 1024 * 1024 for 4MB
   */
  chuckSize?: number;
  retryMax?: number;
  retryInterval?: number;
  timeoutInterval?: number;
  useHttps?: boolean;
  allowBackupHost?: boolean;
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
  key: string;
  /**
   * The current upload progress as a percentage.
   * This value ranges from 0.0 to 1.0.
   */
  percent: number;
}

export interface UploadOptions {
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
  token: string;
  onProgress?: (event: UploadProgressEvent) => void;
}

export class Qiniu {
  private readonly instanceId: string;
  private readonly instanceConfig: QiniuFullConfig;

  /**
   * Creates and configures a new Qiniu client instance.
   * @param config Configuration options for this instance.
   */
  constructor(config: QiniuConfig = {}) {
    const enforceNewInstance = config.enforceNewInstance ?? false;
    config.enforceNewInstance = undefined;
    let fullConfig: QiniuFullConfig = {
      ...config,
      zone: undefined,
    };
    switch (typeof config.zone) {
      case 'string':
        if (Object.values(ZoneRegionId).includes(config.zone as ZoneRegionId)) {
          fullConfig.zone = config.zone;
        } else if (config.zone === 'auto') {
        } else {
          throw new Error(`Invalid zone: ${config.zone}`);
        }
        break;
      case 'object':
        if (config.zone instanceof ZoneCustomDomains) {
          fullConfig.domains = config.zone.domains;
        } else if (config.zone instanceof ZoneCustomUcServers) {
          fullConfig.ucServers = config.zone.ucServers;
        } else {
          throw new Error('Invalid zone configuration');
        }
        break;
      default:
        throw new Error(
          "Zone must be 'auto' or an instance of ZoneCustomDomains/ZoneCustomUcServers"
        );
    }
    if (instanceCache.has(JSON.stringify(fullConfig)) && !enforceNewInstance) {
      this.instanceId = instanceCache.get(JSON.stringify(fullConfig))!;
      refCounts.set(this.instanceId, (refCounts.get(this.instanceId) || 0) + 1);
    } else {
      this.instanceId = uuid.v4();
      instanceCache.set(JSON.stringify(fullConfig), this.instanceId);
      refCounts.set(this.instanceId, 1);
    }
    this.instanceConfig = fullConfig;
    QiniuModule.configure(this.instanceId, fullConfig);
  }

  /**
   * Uploads a file using this instance's configuration.
   * @param options The upload options, including the file path and progress callback.
   * @returns A promise that resolves with the server's response upon success.
   */
  upload(options: UploadOptions): Promise<any> {
    let progressSubscription: EventSubscription | null = null;

    const nativeOptions = {
      ...options,
      // Explicitly tell the native side if a progress listener is attached for this call.
      hasProgressListener: !!options.onProgress,
    };

    if (options.onProgress) {
      progressSubscription = QiniuModule.onQNUpProgressed(
        (event: UploadProgressEvent) => {
          if (event.key === options.key) {
            options.onProgress?.(event);
          }
        }
      );
    }

    return QiniuModule.upload(this.instanceId, nativeOptions).finally(() => {
      progressSubscription?.remove();
    });
  }

  /**
   * Cancels an ongoing upload. This is a static method as cancellation
   * is tied to the upload `key`, not the configuration instance.
   * @param key The unique key of the file upload to cancel.
   */
  cancel(key: string): void {
    QiniuModule.cancel(key);
  }

  /**
   * Destroys the native configuration associated with this instance.
   * Call this when the instance is no longer needed to free up native resources.
   */
  destroy(): void {
    QiniuModule.destroy(this.instanceId);
    const currentCount = refCounts.get(this.instanceId) || 0;
    if (currentCount > 1) {
      refCounts.set(this.instanceId, currentCount - 1);
    } else {
      instanceCache.delete(JSON.stringify(this.instanceConfig));
      refCounts.delete(this.instanceId);
    }
  }
}
