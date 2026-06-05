package cc.zerlight.react.betterqiniu

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
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
import org.json.JSONArray
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

    private fun createUploadResult(
            uploadId: String,
            key: String,
            info: ResponseInfo?,
            response: JSONObject?
    ): WritableMap {
        val raw = response?.toString() ?: "{}"
        return Arguments.createMap().apply {
            putString("uploadId", uploadId)
            putString("key", key)
            putInt("statusCode", info?.statusCode ?: 0)
            putString("requestId", info?.reqId)
            putString("reqId", info?.reqId)
            putString("xlog", info?.xlog)
            putString("xvia", info?.xvia)
            putString("host", info?.host)
            putString("error", info?.error)
            putBoolean("isCancelled", info?.isCancelled ?: false)
            putMap("response", jsonObjectToWritableMap(response))
            putString("raw", raw)
        }
    }

    private fun jsonObjectToWritableMap(jsonObject: JSONObject?): WritableMap {
        val map = Arguments.createMap()
        if (jsonObject == null) {
            return map
        }

        val keys = jsonObject.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            putJsonValue(map, key, jsonObject.opt(key))
        }
        return map
    }

    private fun jsonArrayToWritableArray(jsonArray: JSONArray): WritableArray {
        val array = Arguments.createArray()
        for (index in 0 until jsonArray.length()) {
            when (val value = jsonArray.opt(index)) {
                null, JSONObject.NULL -> array.pushNull()
                is JSONObject -> array.pushMap(jsonObjectToWritableMap(value))
                is JSONArray -> array.pushArray(jsonArrayToWritableArray(value))
                is Boolean -> array.pushBoolean(value)
                is Int -> array.pushInt(value)
                is Long -> array.pushDouble(value.toDouble())
                is Float -> array.pushDouble(value.toDouble())
                is Double -> array.pushDouble(value)
                else -> array.pushString(value.toString())
            }
        }
        return array
    }

    private fun putJsonValue(map: WritableMap, key: String, value: Any?) {
        when (value) {
            null, JSONObject.NULL -> map.putNull(key)
            is JSONObject -> map.putMap(key, jsonObjectToWritableMap(value))
            is JSONArray -> map.putArray(key, jsonArrayToWritableArray(value))
            is Boolean -> map.putBoolean(key, value)
            is Int -> map.putInt(key, value)
            is Long -> map.putDouble(key, value.toDouble())
            is Float -> map.putDouble(key, value.toDouble())
            is Double -> map.putDouble(key, value)
            else -> map.putString(key, value.toString())
        }
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
        val uploadId =
                options.getString("uploadId")
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
        cancellationSignals[uploadId] = cancellationSignal

        val completionHandler: (String?, ResponseInfo?, JSONObject?) -> Unit =
                { _, info, response ->
                    cancellationSignals.remove(uploadId)
                    val uploadResult = createUploadResult(uploadId, key, info, response)
                    if (info?.isOK == true) {
                        promise.resolve(uploadResult)
                    } else {
                        val code =
                                if (info?.isCancelled == true) "UPLOAD_CANCELLED"
                                else "UPLOAD_ERROR"
                        val message =
                                info?.error
                                        ?: info?.toString()
                                        ?: "An unknown error occurred."
                        promise.reject(code, message, uploadResult)
                    }
                }

        val progressHandler: (String?, Double) -> Unit = { progressKey, percent ->
            val eventParams =
                    Arguments.createMap().apply {
                        putString("uploadId", uploadId)
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

    override fun cancel(uploadId: String) {
        cancellationSignals[uploadId]?.cancel()
        cancellationSignals.remove(uploadId)
    }

    override fun destroy(instanceId: String) {
        uploadManagers.remove(instanceId)
    }
}
