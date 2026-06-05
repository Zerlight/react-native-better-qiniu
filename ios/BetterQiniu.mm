#import "BetterQiniu.h"
#import <Qiniu/QiniuSDK.h>

#pragma mark - Lifecycle & Setup

@implementation BetterQiniu
{
  NSMutableDictionary *uploadManagers;
  NSMutableDictionary *cancellationFlags;
}

RCT_EXPORT_MODULE();

- (instancetype)init {
  self = [super init];
  if (self) {
    uploadManagers = [NSMutableDictionary new];
    cancellationFlags = [NSMutableDictionary new];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

#pragma mark - Exported Methods

- (void)configure:(nonnull NSString *)instanceId options:(nonnull NSDictionary *)options
{
  QNConfiguration *configuration = [QNConfiguration buildV2:^(QNConfigurationBuilder *builder) {
    NSString *cacheDir = [NSSearchPathForDirectoriesInDomains(NSCachesDirectory, NSUserDomainMask, YES) firstObject];
    NSString *recorderPath = [cacheDir stringByAppendingPathComponent:@"qiniu_recorder"];
    NSError *error = nil;
    builder.recorder = [QNFileRecorder fileRecorderWithFolder:recorderPath error:&error];
    if (error) {
      NSLog(@"Qiniu file recorder creation failed: %@", error);
    }
    if (options[@"domains"] && [options[@"domains"] isKindOfClass:[NSArray class]]) {
      builder.zone = [[QNFixedZone alloc] initWithUpDomainList:options[@"domains"]];
    }
    else if (options[@"ucServers"] && [options[@"ucServers"] isKindOfClass:[NSArray class]]) {
      if ([options[@"accelerateUploading"] boolValue]) {
        builder.accelerateUploading = YES;
      }
      QNAutoZone *zone = [QNAutoZone zoneWithUcHosts:options[@"ucServers"]];
      builder.zone = zone;
    }
    else if (options[@"zone"] && [options[@"zone"] isKindOfClass:[NSString class]]) {
      builder.zone = [QNFixedZone createWithRegionId:options[@"zone"]];
    }
    else {
      if ([options[@"accelerateUploading"] boolValue]) {
        builder.accelerateUploading = YES;
      }
      builder.zone = [QNAutoZone new];
    }
    if (options[@"putThreshold"]) {
      builder.putThreshold = [options[@"putThreshold"] intValue];
    }
    if (options[@"useConcurrentResumeUpload"]) {
      builder.useConcurrentResumeUpload = [options[@"useConcurrentResumeUpload"] boolValue];
    }
    if (options[@"chunkSize"]) {
      builder.chunkSize = [options[@"chunkSize"] intValue];
    }
    if (options[@"retryMax"]) {
      builder.retryMax = [options[@"retryMax"] intValue];
    }
    if (options[@"retryInterval"]) {
      builder.retryInterval = [options[@"retryInterval"] intValue];
    }
    if (options[@"timeoutInterval"]) {
      builder.timeoutInterval = [options[@"timeoutInterval"] intValue];
    }
    if (options[@"useHttps"]) {
      builder.useHttps = [options[@"useHttps"] boolValue];
    }
    if (options[@"allowBackupHost"]) {
      builder.allowBackupHost = [options[@"allowBackupHost"] boolValue];
    }
    if (options[@"concurrentTaskCount"]) {
      builder.concurrentTaskCount = [options[@"concurrentTaskCount"] intValue];
    }
    NSString *resumeVersion = options[@"resumeUploadVersion"];
    if ([resumeVersion isEqualToString:@"v1"]) {
      builder.resumeUploadVersion = QNResumeUploadVersionV1;
    } else if ([resumeVersion isEqualToString:@"v2"]) {
      builder.resumeUploadVersion = QNResumeUploadVersionV2;
    }
  }];
  
  QNUploadManager *upManager = [[QNUploadManager alloc] initWithConfiguration:configuration];
  
  @synchronized(uploadManagers) {
    uploadManagers[instanceId] = upManager;
  }
}

- (NSString *)jsonStringFromDictionary:(NSDictionary *)dictionary
{
  if (!dictionary) {
    return @"{}";
  }
  
  NSData *jsonData = [NSJSONSerialization dataWithJSONObject:dictionary options:0 error:nil];
  NSString *jsonString = [[NSString alloc] initWithData:jsonData encoding:NSUTF8StringEncoding];
  return jsonString ?: @"{}";
}

- (NSDictionary *)uploadResultForUploadId:(NSString *)uploadId
                                      key:(NSString *)key
                                     info:(QNResponseInfo *)info
                                 response:(NSDictionary *)response
{
  NSMutableDictionary *result = [NSMutableDictionary new];
  NSDictionary *responseBody = response ?: @{};
  result[@"uploadId"] = uploadId ?: @"";
  result[@"key"] = key ?: @"";
  result[@"statusCode"] = @(info ? info.statusCode : 0);
  result[@"response"] = responseBody;
  result[@"raw"] = [self jsonStringFromDictionary:responseBody];
  result[@"isCancelled"] = @(info ? info.isCancelled : NO);
  
  if (info.reqId) {
    result[@"requestId"] = info.reqId;
    result[@"reqId"] = info.reqId;
  }
  if (info.xlog) {
    result[@"xlog"] = info.xlog;
  }
  if (info.xvia) {
    result[@"xvia"] = info.xvia;
  }
  if (info.host) {
    result[@"host"] = info.host;
  }
  if (info.error.localizedDescription) {
    result[@"error"] = info.error.localizedDescription;
  } else if (info.message && !info.isOK) {
    result[@"error"] = info.message;
  }
  
  return result;
}

- (void)upload:(nonnull NSString *)instanceId options:(nonnull NSDictionary *)options resolve:(nonnull RCTPromiseResolveBlock)resolve reject:(nonnull RCTPromiseRejectBlock)reject
{
  QNUploadManager *upManager;
  BOOL hasProgressListener = [options[@"hasProgressListener"] boolValue];
  @synchronized(uploadManagers) {
    upManager = uploadManagers[instanceId];
  }
  
  if (!upManager) {
    NSString *errorMsg = [NSString stringWithFormat:@"Qiniu instance '%@' not configured. Call new Qiniu(config) first.", instanceId];
    reject(@"CONFIG_ERROR", errorMsg, nil);
    return;
  }
  
  NSString *key = options[@"key"];
  NSString *uploadId = options[@"uploadId"];
  NSString *token = options[@"token"];
  NSString *filePath = options[@"filePath"];
  
  if (!key || !uploadId || !token || !filePath) {
    reject(@"INVALID_OPTIONS", @"Insufficient options.", nil);
    return;
  }
  
  @synchronized(cancellationFlags) {
    cancellationFlags[uploadId] = @(NO);
  }
  QNUpCancellationSignal cancellationSignal = ^BOOL() {
    BOOL isCancelled = NO;
    @synchronized(self->cancellationFlags) {
      isCancelled = [self->cancellationFlags[uploadId] boolValue];
    }
    return isCancelled;
  };
  
  QNUpProgressHandler progressHandler = ^(NSString *progressKey, float percent) {
    if (hasProgressListener) {
      [self emitOnQNUpProgressed:@{@"uploadId": uploadId, @"key": progressKey, @"percent": @(percent)}];
    }
  };
  
  QNUploadOption *uploadOption = [[QNUploadOption alloc] initWithMime:nil
                                                      progressHandler:progressHandler
                                                               params:nil
                                                             checkCrc:NO
                                                   cancellationSignal:cancellationSignal];
  
  [upManager putFile:filePath key:key token:token complete:^(QNResponseInfo *info, NSString *respKey, NSDictionary *resp) {
    @synchronized(self->cancellationFlags) {
      [self->cancellationFlags removeObjectForKey:uploadId];
    }
    NSDictionary *uploadResult = [self uploadResultForUploadId:uploadId key:key info:info response:resp];
    if (info && info.isOK) {
      resolve(uploadResult);
    } else {
      NSString *code = (info && info.isCancelled) ? @"UPLOAD_CANCELLED" : @"UPLOAD_ERROR";
      NSString *errorDescription = info.message ?: info.description ?: @"An unknown error occurred.";
      NSError *error = [NSError errorWithDomain:@"BetterQiniu"
                                           code:(info ? info.statusCode : 0)
                                       userInfo:uploadResult];
      reject(code, errorDescription, error);
    }
  } option:uploadOption];
}

- (void)cancel:(NSString *)uploadId
{
  if (uploadId) {
    @synchronized(cancellationFlags) {
      cancellationFlags[uploadId] = @(YES);
    }
  }
}

- (void)destroy:(NSString *)instanceId
{
  if (instanceId) {
    @synchronized(uploadManagers) {
      [uploadManagers removeObjectForKey:instanceId];
    }
  }
}

#pragma mark - Other

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeBetterQiniuSpecJSI>(params);
}

@end
