import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  Qiniu,
  QiniuUploadError,
  type UploadTask,
} from 'react-native-better-qiniu';
import QuickCrypto from 'react-native-quick-crypto';
import {
  pick,
  types,
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
} from '@react-native-documents/picker';
import { Buffer } from '@craftzdog/react-native-buffer';

type DemoCredentials = {
  bucketName: string;
  accessKey: string;
  secretKey: string;
  objectKey: string;
};

type DemoCredentialField = keyof DemoCredentials;

const emptyCredentials: DemoCredentials = {
  bucketName: '',
  accessKey: '',
  secretKey: '',
  objectKey: '',
};

const urlsafe_base64_encode = (str: string) => {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

const hmac_sha1 = (key: string, data: string) =>
  QuickCrypto.createHmac('sha1', key).update(data).digest('base64');

const normalizeCredentials = (
  credentials: DemoCredentials
): DemoCredentials => ({
  bucketName: credentials.bucketName.trim(),
  accessKey: credentials.accessKey.trim(),
  secretKey: credentials.secretKey.trim(),
  objectKey: credentials.objectKey.trim(),
});

const getMissingCredentialFields = (credentials: DemoCredentials) => {
  const missingFields: string[] = [];

  if (!credentials.bucketName) {
    missingFields.push('Bucket');
  }
  if (!credentials.accessKey) {
    missingFields.push('Access Key');
  }
  if (!credentials.secretKey) {
    missingFields.push('Secret Key');
  }
  if (!credentials.objectKey) {
    missingFields.push('Object Key');
  }

  return missingFields;
};

const createDemoUploadToken = ({
  bucketName,
  accessKey,
  secretKey,
  key,
}: {
  bucketName: string;
  accessKey: string;
  secretKey: string;
  key: string;
}) => {
  const scope = `${bucketName}:${key}`;
  const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const returnBody = {
    message: 'Upload successful',
    file: '${fname}',
    size: '${fsize}',
    hash: '${etag}',
  };
  const putPolicy = JSON.stringify({
    scope,
    deadline,
    returnBody: JSON.stringify(returnBody),
  });
  const encodedPutPolicy = urlsafe_base64_encode(putPolicy);
  const sign = hmac_sha1(secretKey, encodedPutPolicy);
  const encodedSign = sign.replace(/\//g, '_').replace(/\+/g, '-');
  return `${accessKey}:${encodedSign}:${encodedPutPolicy}`;
};

export default function App() {
  const [credentials, setCredentials] =
    useState<DemoCredentials>(emptyCredentials);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);
  const credentialsRef = useRef(credentials);
  const currentTaskRef = useRef<UploadTask | null>(null);

  const qiniu = useMemo(
    () =>
      Qiniu.shared({
        zone: 'auto',
        resumeUploadVersion: 'v2',
        useConcurrentResumeUpload: true,
        putThreshold: 4 * 1024 * 1024, // 4MB
        tokenProvider: ({ key }) => {
          const currentCredentials = normalizeCredentials(
            credentialsRef.current
          );

          return createDemoUploadToken({
            bucketName: currentCredentials.bucketName,
            accessKey: currentCredentials.accessKey,
            secretKey: currentCredentials.secretKey,
            key,
          });
        },
      }),
    []
  );

  useEffect(() => {
    credentialsRef.current = credentials;
  }, [credentials]);

  useEffect(() => {
    return () => {
      qiniu.destroy();
    };
  }, [qiniu]);

  const updateCredential = (field: DemoCredentialField, value: string) => {
    setCredentials((currentCredentials) => ({
      ...currentCredentials,
      [field]: value,
    }));
  };

  const requestStoragePermission = async () => {
    if (Platform.OS !== 'android') {
      return true;
    }
    try {
      if (Number(Platform.Version) >= 33) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
        ]);
        return (
          granted['android.permission.READ_MEDIA_IMAGES'] ===
            PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.READ_MEDIA_VIDEO'] ===
            PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          {
            title: '需要存储权限',
            message: '此应用需要访问您的文件来进行文件上传和管理。',
            buttonPositive: '确定',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      console.warn(err);
      return false;
    }
  };

  const handleAddFile = async (): Promise<string | null> => {
    if (Platform.OS === 'android') {
      const granted = await requestStoragePermission();
      if (!granted) {
        Alert.alert('无文件访问权限', '请在设置中授予应用存储权限以选择文件。');
        return null;
      }
    }

    try {
      const results = await pick({
        allowMultiSelection: false,
        type: [types.allFiles],
      });

      const file = results[0];
      if (file?.uri && Platform.OS !== 'macos' && Platform.OS !== 'windows') {
        const [copyResult] = await keepLocalCopy({
          files: [
            {
              uri: file.uri,
              fileName: file.name ?? new Date().toISOString(),
            },
          ],
          destination: 'cachesDirectory',
        });
        if (copyResult.status === 'success') {
          console.log('Selected file: ', copyResult.localUri);
          return decodeURIComponent(copyResult.localUri).replace('file://', '');
        }
      } else if (file?.uri) {
        console.log('Selected file: ', file.uri);
        return decodeURIComponent(file.uri).replace('file://', '');
      }
      return null;
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        console.log('User cancelled the file picker.');
      } else {
        console.error('File picker error: ', err);
      }
      return null;
    }
  };

  const handleUpload = async () => {
    console.log('Starting upload...');
    const currentCredentials = normalizeCredentials(credentials);
    const missingFields = getMissingCredentialFields(currentCredentials);

    if (missingFields.length > 0) {
      setError(`Please fill ${missingFields.join(', ')} before uploading.`);
      return;
    }

    setIsUploading(true);
    setResult(null);
    setError(null);
    setUploadProgress(0);
    const filePath = await handleAddFile();
    if (!filePath) {
      console.error('No file selected for upload.');
      setIsUploading(false);
      return;
    }
    console.log('Selected file path:', filePath);

    const task = qiniu.createUploadTask({
      uploadId: `${currentCredentials.objectKey}-${Date.now()}`,
      filePath,
      key: currentCredentials.objectKey,
    });
    currentTaskRef.current = task;
    const subscription = task.onProgress((event) => {
      setUploadProgress(event.percent);
      console.log(`Upload Progress: ${Math.round(event.percent * 100)}%`);
    });

    console.log('Uploading file:', filePath);
    task
      .start()
      .then((response) => {
        setUploadProgress(1);
        setResult(JSON.stringify(response, null, 2));
        setError(null);
        console.log('Upload complete!', response);
      })
      .catch((err) => {
        if (err instanceof QiniuUploadError && err.isCancelled) {
          setError('Upload cancelled.');
        } else {
          setError(err instanceof Error ? err.message : String(err));
        }
        console.error('Upload failed or was cancelled.', err);
      })
      .finally(() => {
        subscription.remove();
        if (currentTaskRef.current === task) {
          currentTaskRef.current = null;
        }
        setIsUploading(false);
      });
  };

  const handleCancelUpload = () => {
    console.log('Cancelling upload...');
    currentTaskRef.current?.cancel();
    currentTaskRef.current = null;
    setIsUploading(false);
    setUploadProgress(0);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Qiniu Upload Demo</Text>
      <View style={styles.form}>
        <Text style={styles.label}>Bucket</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => updateCredential('bucketName', value)}
          placeholder="your-bucket-name"
          placeholderTextColor="#8a94a6"
          style={styles.input}
          value={credentials.bucketName}
        />
        <Text style={styles.label}>Access Key</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => updateCredential('accessKey', value)}
          placeholder="your-access-key"
          placeholderTextColor="#8a94a6"
          style={styles.input}
          value={credentials.accessKey}
        />
        <Text style={styles.label}>Secret Key</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => updateCredential('secretKey', value)}
          placeholder="your-secret-key"
          placeholderTextColor="#8a94a6"
          secureTextEntry
          style={styles.input}
          value={credentials.secretKey}
        />
        <Text style={styles.label}>Object Key</Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={(value) => updateCredential('objectKey', value)}
          placeholder="uploads/demo-file"
          placeholderTextColor="#8a94a6"
          style={styles.input}
          value={credentials.objectKey}
        />
      </View>
      {isUploading ? (
        <View style={styles.actions}>
          <ActivityIndicator size="large" style={styles.activity} />
          <Button title="Cancel" onPress={handleCancelUpload} />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button title="Select File & Start Upload" onPress={handleUpload} />
        </View>
      )}
      {isUploading && (
        <Text style={styles.progress}>
          Uploading... Process: {Math.round(uploadProgress * 100)}%
        </Text>
      )}
      {result && <Text style={styles.result}>Upload Result: {result}</Text>}
      {error && <Text style={styles.error}>Error: {error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
    backgroundColor: '#f6f8fb',
  },
  title: {
    color: '#172033',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'center',
  },
  form: {
    width: '100%',
    gap: 8,
  },
  label: {
    color: '#2d3748',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  input: {
    width: '100%',
    minHeight: 46,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    color: '#172033',
    fontSize: 15,
    paddingHorizontal: 12,
  },
  actions: {
    marginBottom: 20,
    marginTop: 24,
  },
  activity: {
    marginBottom: 20,
  },
  progress: {
    color: '#172033',
    textAlign: 'center',
  },
  result: {
    color: '#16833a',
    marginTop: 20,
  },
  error: {
    color: '#c92a2a',
    marginTop: 20,
  },
});
