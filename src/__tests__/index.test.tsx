type NativeModuleMock = {
  configure: jest.Mock;
  upload: jest.Mock;
  cancel: jest.Mock;
  destroy: jest.Mock;
  onQNUpProgressed: jest.Mock;
};

const createNativeModule = (): NativeModuleMock => ({
  configure: jest.fn(),
  upload: jest.fn(() => Promise.resolve({})),
  cancel: jest.fn(),
  destroy: jest.fn(),
  onQNUpProgressed: jest.fn(() => ({ remove: jest.fn() })),
});

let nativeModule: NativeModuleMock;
let uuidIndex: number;

const loadLibrary = (): typeof import('../index') => {
  jest.resetModules();
  nativeModule = createNativeModule();
  uuidIndex = 0;

  jest.doMock('react-native', () => ({
    NativeModules: {
      BetterQiniu: nativeModule,
    },
    Platform: {
      select: (options: { default?: string }) => options.default ?? '',
    },
  }));

  jest.doMock('react-native-uuid', () => ({
    __esModule: true,
    default: {
      v4: jest.fn(() => {
        uuidIndex += 1;
        return `uuid-${uuidIndex}`;
      }),
    },
  }));

  return require('../index');
};

describe('Qiniu configuration', () => {
  it('uses AutoZone by default', () => {
    const { Qiniu } = loadLibrary();

    new Qiniu();

    expect(nativeModule.configure).toHaveBeenCalledWith('uuid-1', {
      zone: undefined,
    });
  });

  it('passes chunkSize through to native configuration', () => {
    const { Qiniu } = loadLibrary();

    new Qiniu({ zone: 'auto', chunkSize: 4 * 1024 * 1024 });

    expect(nativeModule.configure).toHaveBeenCalledWith('uuid-1', {
      zone: undefined,
      chunkSize: 4 * 1024 * 1024,
    });
  });

  it('does not mutate the user config object', () => {
    const { Qiniu } = loadLibrary();
    const config = { zone: 'auto' as const, enforceNewInstance: true };

    new Qiniu(config);

    expect(config).toEqual({ zone: 'auto', enforceNewInstance: true });
  });

  it('rejects invalid string zones', () => {
    const { Qiniu } = loadLibrary();

    expect(() => new Qiniu({ zone: 'invalid-zone' as any })).toThrow(
      'Invalid zone: invalid-zone'
    );
  });

  it('reuses cached native instances for identical configuration', () => {
    const { Qiniu } = loadLibrary();

    const qiniu1 = new Qiniu({ zone: 'auto' });
    const qiniu2 = new Qiniu({ zone: 'auto' });

    expect(nativeModule.configure).toHaveBeenCalledTimes(1);
    qiniu1.destroy();
    expect(nativeModule.destroy).not.toHaveBeenCalled();
    qiniu2.destroy();
    expect(nativeModule.destroy).toHaveBeenCalledWith('uuid-1');
  });
});

describe('Qiniu uploads', () => {
  it('creates upload tasks with explicit and generated upload IDs', () => {
    const { Qiniu } = loadLibrary();
    const qiniu = new Qiniu();

    const explicitTask = qiniu.createUploadTask({
      uploadId: 'upload-explicit',
      filePath: '/tmp/file.jpg',
      key: 'explicit-key.jpg',
      token: 'token',
    });
    const generatedTask = qiniu.createUploadTask({
      filePath: '/tmp/file.jpg',
      key: 'generated-key.jpg',
      token: 'token',
    });

    expect(explicitTask.uploadId).toBe('upload-explicit');
    expect(explicitTask.key).toBe('explicit-key.jpg');
    expect(explicitTask.status).toBe('idle');
    expect(generatedTask.uploadId).toBe('uuid-2');
  });

  it('filters progress events by uploadId', async () => {
    const { Qiniu } = loadLibrary();
    const remove = jest.fn();
    const onProgress = jest.fn();
    let resolveUpload: (value: string) => void = () => {};
    let progressHandler:
      | ((event: { uploadId: string; key: string; percent: number }) => void)
      | undefined;

    nativeModule.onQNUpProgressed.mockImplementation((handler) => {
      progressHandler = handler;
      return { remove };
    });
    nativeModule.upload.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        })
    );

    const qiniu = new Qiniu();
    const uploadPromise = qiniu.upload({
      uploadId: 'upload-1',
      filePath: '/tmp/file.jpg',
      key: 'same-key.jpg',
      token: 'token',
      onProgress,
    });

    progressHandler?.({
      uploadId: 'upload-2',
      key: 'same-key.jpg',
      percent: 0.25,
    });
    progressHandler?.({
      uploadId: 'upload-1',
      key: 'same-key.jpg',
      percent: 0.5,
    });

    resolveUpload('{"ok":true}');
    const result = await uploadPromise;

    expect(result).toBe('{"ok":true}');
    expect(nativeModule.upload).toHaveBeenCalledWith(
      'uuid-1',
      expect.objectContaining({
        uploadId: 'upload-1',
        key: 'same-key.jpg',
        hasProgressListener: true,
      })
    );
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      key: 'same-key.jpg',
      percent: 0.5,
    });
    expect(remove).toHaveBeenCalled();
  });

  it('supports task-scoped progress listeners and unsubscribe', async () => {
    const { Qiniu } = loadLibrary();
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    let resolveUpload: (value: string) => void = () => {};
    let progressHandler:
      | ((event: { uploadId: string; key: string; percent: number }) => void)
      | undefined;

    nativeModule.onQNUpProgressed.mockImplementation((handler) => {
      progressHandler = handler;
      return { remove: jest.fn() };
    });
    nativeModule.upload.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveUpload = resolve;
        })
    );

    const qiniu = new Qiniu();
    const task = qiniu.createUploadTask({
      uploadId: 'upload-1',
      filePath: '/tmp/file.jpg',
      key: 'same-key.jpg',
      token: 'token',
    });
    task.onProgress(listener1);
    const subscription = task.onProgress(listener2);
    subscription.remove();

    const uploadPromise = task.start();
    progressHandler?.({
      uploadId: 'upload-1',
      key: 'same-key.jpg',
      percent: 0.5,
    });
    resolveUpload('{"ok":true}');
    await uploadPromise;

    expect(listener1).toHaveBeenCalledWith({
      uploadId: 'upload-1',
      key: 'same-key.jpg',
      percent: 0.5,
    });
    expect(listener2).not.toHaveBeenCalled();
  });

  it('starts a task only once', async () => {
    const { Qiniu } = loadLibrary();
    const qiniu = new Qiniu();
    const task = qiniu.createUploadTask({
      uploadId: 'upload-1',
      filePath: '/tmp/file.jpg',
      key: 'same-key.jpg',
      token: 'token',
    });

    nativeModule.upload.mockResolvedValue('{"ok":true}');

    const promise1 = task.start();
    const promise2 = task.start();
    const result = await promise2;

    expect(promise2).toBe(promise1);
    expect(result).toBe('{"ok":true}');
    expect(task.status).toBe('success');
    expect(nativeModule.upload).toHaveBeenCalledTimes(1);
  });

  it('cancels a task by uploadId', () => {
    const { Qiniu } = loadLibrary();
    const qiniu = new Qiniu();
    const task = qiniu.createUploadTask({
      uploadId: 'upload-1',
      filePath: '/tmp/file.jpg',
      key: 'same-key.jpg',
      token: 'token',
    });

    task.cancel();

    expect(task.status).toBe('cancelled');
    expect(nativeModule.cancel).toHaveBeenCalledWith('upload-1');
  });

  it('cancels by uploadId', () => {
    const { Qiniu } = loadLibrary();
    const qiniu = new Qiniu();

    qiniu.cancel('upload-1');

    expect(nativeModule.cancel).toHaveBeenCalledWith('upload-1');
  });
});

export {};
