import { useState } from 'react';
import {
  Text,
  View,
  StyleSheet,
  Button,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  Alert,
} from 'react-native';
import { Qiniu } from 'react-native-better-qiniu';
import QuickCrypto from 'react-native-quick-crypto';
import {
  pick,
  types,
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
} from '@react-native-documents/picker';
import { Buffer } from '@craftzdog/react-native-buffer';

// =[!]= IMPORTANT: This is only for testing purposes. Do NOT use this in production. =[!]=
// Distribute your own access key and secret key from server instead of hardcoded.
// Also currently there's a problem with Android's continuous upload on high versions (which caused by the picker and cache copying).

// Replace with your own bucket name, access key, and secret key.
const BUCKET_NAME = 'your-bucket-name'; // Replace with your actual bucket name
const AK = 'your-access-key'; // Replace with your actual Access Key
const SK = 'your-secret-key'; // Replace with your actual Secret Key
const TEST_FILE_NAME = 'testfile.dummy';

const urlsafe_base64_encode = (str: string) => {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
};

const hmac_sha1 = (key: string, data: string) =>
  QuickCrypto.createHmac('sha1', key).update(data).digest('base64');

export default function App() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);

  // Initialize Qiniu instance
  const qiniu = new Qiniu({
    zone: 'auto',
    resumeUploadVersion: 'v2',
    useConcurrentResumeUpload: true,
    putThreshold: 4 * 1024 * 1024, // 4MB
  });

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
    // Below are the token generation steps, only for demonstration purposes.
    // In production, you should generate the token on your server and pass it to the app
    const scope = `${BUCKET_NAME}:${TEST_FILE_NAME}`;
    console.log('Scope:', scope);
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
    console.log('Put Policy:', putPolicy);
    const encodedPutPolicy = urlsafe_base64_encode(putPolicy);
    console.log('Encoded Put Policy:', encodedPutPolicy);
    const sign = hmac_sha1(SK, encodedPutPolicy);
    console.log('Signature:', sign);
    const encodedSign = sign.replace(/\//g, '_').replace(/\+/g, '-');
    const uploadToken = `${AK}:${encodedSign}:${encodedPutPolicy}`;
    console.log('Generated upload token:', uploadToken);

    if (!filePath) {
      console.error('File path is not set.');
      return;
    }
    // Upload file
    console.log('Uploading file:', filePath);
    qiniu
      .upload({
        filePath,
        key: 'testfile.dummy',
        token: uploadToken,
        onProgress: (event) => {
          setUploadProgress(event.percent);
          console.log(`Upload Progress: ${Math.round(event.percent * 100)}%`);
        },
      })
      .then((response) => {
        setUploadProgress(100);
        setResult(JSON.stringify(response));
        setIsUploading(false);
        setError(null);
        console.log('Upload complete!', response);
      })
      .catch((err) => {
        setIsUploading(false);
        setError(err.message);
        console.error('Upload failed or was cancelled.', err);
      });
  };

  const handleCancelUpload = () => {
    console.log('Cancelling upload...');
    qiniu.cancel('testfile.dummy');
    setIsUploading(false);
    setUploadProgress(0);
  };

  return (
    <View style={styles.container}>
      <Text>React Native Better Qiniu Example</Text>
      {isUploading ? (
        <View style={{ marginTop: 20, marginBottom: 20 }}>
          <ActivityIndicator size="large" style={{ marginBottom: 20 }} />
          <Button title="Cancel" onPress={handleCancelUpload} />
        </View>
      ) : (
        <View style={{ marginTop: 20, marginBottom: 20 }}>
          <Button title="Select File & Start Upload" onPress={handleUpload} />
        </View>
      )}
      {isUploading && (
        <Text>Uploading... Process: {Math.round(uploadProgress * 100)}%</Text>
      )}
      {result && (
        <Text style={{ marginTop: 20, color: 'green' }}>
          Upload Result: {result}
        </Text>
      )}
      {error && (
        <Text style={{ marginTop: 20, color: 'red' }}>Error: {error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
});
