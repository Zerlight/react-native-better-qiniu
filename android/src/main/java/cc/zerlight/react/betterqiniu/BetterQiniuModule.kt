package cc.zerlight.react.betterqiniu

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.qiniu.android.common.AutoZone
import com.qiniu.android.common.FixedZone
import com.qiniu.android.http.ResponseInfo
import com.qiniu.android.storage.Configuration
import com.qiniu.android.storage.FileRecorder
import com.qiniu.android.storage.UpCancellationSignal
import com.qiniu.android.storage.UploadManager
import com.qiniu.android.storage.UploadOptions
import com.qiniu.android.utils.Utils
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONObject

@ReactModule(name = BetterQiniuModule.NAME)
class BetterQiniuModule(reactContext: ReactApplicationContext) : NativeBetterQiniuSpec(reactContext) {

    companion object {
        const val NAME = "BetterQiniu"
    }

    override fun getName() = NAME

    private val uploadManagers = ConcurrentHashMap<String, UploadManager>()
    private val cancellationSignals = ConcurrentHashMap<String, CancellationSignal>()

    override fun configure(instanceId: String, options: ReadableMap) {
        val builder = Configuration.Builder()
        var recorder: FileRecorder? = null
        try {
            recorder = FileRecorder(Utils.sdkDirectory() + "/recorder")
        } catch (e: IOException) {
            e.printStackTrace()
        }
        if (recorder != null) {
            builder.recorder(recorder)
        }
        if (options.hasKey("domains")) {
            options.getArray("domains")?.let { domains ->
                val domainArray = Array(domains.size()) { i -> domains.getString(i) ?: "" }
                val zone = FixedZone(domainArray)
                builder.zone(zone)
            }
        } else if (options.hasKey("ucServers")) {
            if (options.hasKey("accelerateUploading") && options.getBoolean("accelerateUploading")
            ) {
                builder.accelerateUploading(true)
            }
            options.getArray("ucServers")?.let { ucServers ->
                val ucServerArray = Array(ucServers.size()) { i -> ucServers.getString(i) ?: "" }
                val zone = AutoZone()
                zone.setUcServers(ucServerArray)
                builder.zone(zone)
            }
        } else if (options.hasKey("zone")) {
            val zone = FixedZone.createWithRegionId(options.getString("zone"))
            builder.zone(zone)
        } else {
            if (options.hasKey("accelerateUploading") && options.getBoolean("accelerateUploading")
            ) {
                builder.accelerateUploading(true)
            }
            val zone = AutoZone()
            builder.zone(zone)
        }

        if (options.hasKey("putThreshold")) {
            builder.putThreshold(options.getInt("putThreshold"))
        }
        if (options.hasKey("useConcurrentResumeUpload")) {
            builder.useConcurrentResumeUpload(options.getBoolean("useConcurrentResumeUpload"))
        }
        if (options.hasKey("resumeUploadVersion") &&
                        options.getString("resumeUploadVersion") == "v2"
        ) {
            builder.resumeUploadVersion(Configuration.RESUME_UPLOAD_VERSION_V2)
        }
        if (options.hasKey("resumeUploadVersion") &&
                        options.getString("resumeUploadVersion") == "v1"
        ) {
            builder.resumeUploadVersion(Configuration.RESUME_UPLOAD_VERSION_V1)
        }
        if (options.hasKey("chunkSize")) {
            builder.chunkSize(options.getInt("chunkSize"))
        }
        if (options.hasKey("retryMax")) {
            builder.retryMax(options.getInt("retryMax"))
        }
        if (options.hasKey("retryInterval")) {
            builder.retryInterval(options.getInt("retryInterval"))
        }
        if (options.hasKey("timeoutInterval")) {
            builder.responseTimeout(options.getInt("timeoutInterval"))
            builder.connectTimeout(options.getInt("timeoutInterval"))
        }
        if (options.hasKey("useHttps")) {
            builder.useHttps(options.getBoolean("useHttps"))
        }
        if (options.hasKey("allowBackupHost")) {
            builder.allowBackupHost(options.getBoolean("allowBackupHost"))
        }
        if (options.hasKey("concurrentTaskCount")) {
            builder.concurrentTaskCount(options.getInt("concurrentTaskCount"))
        }

        val config = builder.buildV2()

        val uploadManager = UploadManager(config)
        uploadManagers[instanceId] = uploadManager
    }

    private fun sendEvent(eventName: String, params: WritableMap?) {
        reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
    }

    private class CancellationSignal : com.qiniu.android.storage.UpCancellationSignal {
        @Volatile private var isCancelled = false

        fun cancel() {
            isCancelled = true
        }
        override fun isCancelled(): Boolean = isCancelled
    }

    override fun upload(instanceId: String, options: ReadableMap, promise: Promise) {
        val uploadManager =
                uploadManagers[instanceId]
                        ?: run {
                            promise.reject(
                                    "CONFIG_ERROR",
                                    "Qiniu instance '$instanceId' not configured. Call new Qiniu(config) first."
                            )
                            return
                        }
        val key =
                options.getString("key")
                        ?: run {
                            promise.reject("INVALID_OPTIONS", "Insufficient options.")
                            return
                        }
        val token =
                options.getString("token")
                        ?: run {
                            promise.reject("INVALID_OPTIONS", "Insufficient options.")
                            return
                        }
        val filePath =
                options.getString("filePath")
                        ?: run {
                            promise.reject("INVALID_OPTIONS", "Insufficient options.")
                            return
                        }
        val hasProgressListener = options.getBoolean("hasProgressListener")
        val cancellationSignal = CancellationSignal()
        cancellationSignals[key] = cancellationSignal

        val completionHandler: (String?, ResponseInfo?, JSONObject?) -> Unit =
                { _, info, response ->
                    cancellationSignals.remove(key)
                    if (info?.isOK == true) {
                        promise.resolve(response?.toString() ?: "{}")
                    } else {
                        promise.reject("UPLOAD_ERROR", info?.toString())
                    }
                }

        val progressHandler: (String?, Double) -> Unit = { progressKey, percent ->
            val eventParams =
                    Arguments.createMap().apply {
                        putString("key", progressKey)
                        putDouble("percent", percent)
                    }
            if (hasProgressListener) {
                emitOnQNUpProgressed(eventParams)
            }
        }

        val uploadOptions = UploadOptions(null, null, false, progressHandler, cancellationSignal)

        uploadManager.put(filePath, key, token, completionHandler, uploadOptions)
    }

    override fun cancel(key: String) {
        cancellationSignals[key]?.cancel()
        cancellationSignals.remove(key)
    }

    override fun destroy(instanceId: String) {
        uploadManagers.remove(instanceId)
    }
}
