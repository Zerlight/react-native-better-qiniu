import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import type { EventEmitter } from 'react-native/Libraries/Types/CodegenTypes';

interface UploadProgressEvent {
  key: string;
  percent: number;
}

export interface Spec extends TurboModule {
  configure(instanceId: string, options: Object): void;
  upload(instanceId: string, options: Object): Promise<Object>;
  cancel(key: string): void;
  destroy(instanceId: string): void;

  readonly onQNUpProgressed: EventEmitter<UploadProgressEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('BetterQiniu');
