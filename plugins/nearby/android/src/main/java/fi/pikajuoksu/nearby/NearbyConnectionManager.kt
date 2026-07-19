package fi.pikajuoksu.nearby

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.getcapacitor.JSObject
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * NearbyConnectionManager kapseloi KAIKEN Google Nearby Connections -logiikan.
 *
 * Itsekorjautuva: yrittää käynnistää mainostuksen (Camera) tai etsinnän
 * (Viewer) toistuvasti, kunnes yhteys syntyy. Näin yhteys muodostuu vaikka
 * käyttöoikeudet myönnettäisiin vasta ensimmäisen yrityksen jälkeen tai
 * sijaintipalvelu käynnistettäisiin hetkeä myöhemmin.
 *
 * Ei internetiä, IP-osoitteita, QR-koodeja eikä manuaalista määritystä.
 * Strategia P2P_STAR sallii usean kameran liittymisen yhteen Vieweriin.
 */
class NearbyConnectionManager(
    private val context: Context,
    private val emit: (event: String, data: JSObject) -> Unit,
) {
    companion object {
        private const val TAG = "NearbyConnManager"
        private val STRATEGY = Strategy.P2P_STAR
        private const val RETRY_MS = 5000L
    }

    private val client: ConnectionsClient = Nearby.getConnectionsClient(context)
    private val handler = Handler(Looper.getMainLooper())

    /** Yhdistetyt vastapuolet (endpointId -> nimi). */
    private val connected = mutableMapOf<String, String>()

    /** Löydettyjen (ei vielä yhdistettyjen) nimet. */
    private val discoveredNames = mutableMapOf<String, String>()

    /** Odottavat tiedostosiirtojen metatiedot (payloadId -> metadataJson). */
    private val pendingFileMeta = mutableMapOf<Long, String>()

    /** Vastaanotettavat tiedostohyötykuormat. */
    private val incomingFiles = mutableMapOf<Long, Payload>()

    private var localName: String = "FSD"
    private var serviceId: String = "fi.pikajuoksu.startwatch.nearby"
    private var role: String = "" // "camera" | "viewer"
    private var advertising = false
    private var discovering = false
    private var retryScheduled = false

    // ---- Julkinen rajapinta ----

    fun startAdvertising(name: String, service: String) {
        localName = name
        serviceId = service
        role = "camera"
        ensureRunning()
    }

    fun startDiscovery(name: String, service: String) {
        localName = name
        serviceId = service
        role = "viewer"
        ensureRunning()
    }

    fun stop() {
        role = ""
        advertising = false
        discovering = false
        try {
            client.stopAdvertising()
            client.stopDiscovery()
            client.stopAllEndpoints()
        } catch (e: Exception) {
            Log.w(TAG, "stop() virhe", e)
        }
        connected.clear()
        discoveredNames.clear()
        pendingFileMeta.clear()
        incomingFiles.clear()
        emitStatus()
    }

    fun sendMessage(json: String) {
        val payload = Payload.fromBytes(json.toByteArray(Charsets.UTF_8))
        for (endpointId in connected.keys) client.sendPayload(endpointId, payload)
    }

    fun sendFile(path: String, metadataJson: String) {
        val file = resolveFile(path) ?: run {
            Log.e(TAG, "Tiedostoa ei löytynyt: $path")
            return
        }
        val filePayload = Payload.fromFile(file)
        val header = JSONObject()
            .put("type", "VIDEO_TRANSFER")
            .put("payloadId", filePayload.id)
            .put("metadata", JSONObject(metadataJson))
            .toString()
        val headerPayload = Payload.fromBytes(header.toByteArray(Charsets.UTF_8))
        for (endpointId in connected.keys) {
            client.sendPayload(endpointId, headerPayload)
            client.sendPayload(endpointId, filePayload)
        }
    }

    fun currentStatus(): JSObject {
        val status = when {
            connected.isNotEmpty() -> "connected"
            role.isNotEmpty() -> "searching"
            else -> "disconnected"
        }
        val obj = JSObject().put("status", status)
        connected.values.firstOrNull()?.let { obj.put("endpointName", it) }
        return obj
    }

    // ---- Itsekorjautuva käynnistys ----

    /** Käynnistää roolin mukaisen toiminnon, jos se ei ole jo käynnissä. */
    private fun ensureRunning() {
        when (role) {
            "camera" -> if (!advertising) doAdvertise()
            "viewer" -> if (!discovering) doDiscover()
        }
        scheduleTick()
        emitStatus()
    }

    private fun doAdvertise() {
        val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
        client.startAdvertising(localName, serviceId, connectionLifecycle, options)
            .addOnSuccessListener {
                advertising = true
                Log.i(TAG, "Advertising käynnissä")
                emitStatus()
            }
            .addOnFailureListener { e ->
                advertising = false
                Log.w(TAG, "Advertising epäonnistui (yritetään uudelleen): ${e.message}")
            }
    }

    private fun doDiscover() {
        val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
        client.startDiscovery(serviceId, endpointDiscovery, options)
            .addOnSuccessListener {
                discovering = true
                Log.i(TAG, "Discovery käynnissä")
                emitStatus()
            }
            .addOnFailureListener { e ->
                discovering = false
                Log.w(TAG, "Discovery epäonnistui (yritetään uudelleen): ${e.message}")
            }
    }

    /** Ajastaa uuden yrityksen, kunnes yhteys on muodostunut. */
    private fun scheduleTick() {
        if (retryScheduled) return
        retryScheduled = true
        handler.postDelayed({
            retryScheduled = false
            if (role.isNotEmpty()) {
                // Yritä (uudelleen)käynnistää, jos toiminto ei ole aktiivinen.
                ensureRunning()
            }
        }, RETRY_MS)
    }

    // ---- Nearby-callbackit ----

    private val connectionLifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            discoveredNames[endpointId] = info.endpointName
            client.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
            if (resolution.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
                connected[endpointId] = discoveredNames[endpointId] ?: endpointId
                Log.i(TAG, "Yhdistetty: $endpointId")
            } else {
                Log.w(TAG, "Yhteys ei onnistunut: ${resolution.status.statusCode}")
            }
            emitStatus()
        }

        override fun onDisconnected(endpointId: String) {
            connected.remove(endpointId)
            Log.i(TAG, "Yhteys katkesi: $endpointId")
            // Jatka etsintää/mainostusta automaattisesti.
            ensureRunning()
            emitStatus()
        }
    }

    private val endpointDiscovery = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            if (info.serviceId != serviceId) return
            discoveredNames[endpointId] = info.endpointName
            Log.i(TAG, "Kamera löytyi: ${info.endpointName} → pyydetään yhteyttä")
            client.requestConnection(localName, endpointId, connectionLifecycle)
                .addOnFailureListener { e -> Log.w(TAG, "requestConnection epäonnistui: ${e.message}") }
        }

        override fun onEndpointLost(endpointId: String) {
            discoveredNames.remove(endpointId)
            Log.i(TAG, "Endpoint kadonnut: $endpointId")
        }
    }

    private val payloadCallback = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            when (payload.type) {
                Payload.Type.BYTES -> handleBytes(payload)
                Payload.Type.FILE -> incomingFiles[payload.id] = payload
                else -> {}
            }
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
            val total = update.totalBytes
            val transferred = update.bytesTransferred
            val fraction = if (total > 0) transferred.toDouble() / total.toDouble() else 0.0
            val done = update.status != PayloadTransferUpdate.Status.IN_PROGRESS
            val incoming = incomingFiles.containsKey(update.payloadId)

            if (incoming || role == "camera") {
                val ev = JSObject()
                    .put("bytesTransferred", transferred)
                    .put("totalBytes", total)
                    .put("fraction", fraction)
                    .put("done", done)
                    .put("direction", if (incoming) "incoming" else "outgoing")
                emit("transferProgress", ev)
            }

            if (done && update.status == PayloadTransferUpdate.Status.SUCCESS) {
                val filePayload = incomingFiles.remove(update.payloadId) ?: return
                finishIncomingFile(update.payloadId, filePayload)
            }
        }
    }

    // ---- Apurit ----

    private fun handleBytes(payload: Payload) {
        val bytes = payload.asBytes() ?: return
        val json = String(bytes, Charsets.UTF_8)
        try {
            val obj = JSONObject(json)
            if (obj.optString("type") == "VIDEO_TRANSFER" && obj.has("payloadId")) {
                pendingFileMeta[obj.getLong("payloadId")] = obj.getJSONObject("metadata").toString()
            } else {
                emit("messageReceived", JSObject().put("json", json))
            }
        } catch (e: Exception) {
            Log.w(TAG, "Virheellinen BYTES-viesti", e)
        }
    }

    private fun finishIncomingFile(payloadId: Long, filePayload: Payload) {
        try {
            val uri: Uri? = filePayload.asFile()?.asUri()
            val dest = File(context.filesDir, "received_${System.currentTimeMillis()}.mp4")
            if (uri != null) {
                context.contentResolver.openInputStream(uri)?.use { input ->
                    FileOutputStream(dest).use { output -> input.copyTo(output) }
                }
            } else {
                @Suppress("DEPRECATION")
                filePayload.asFile()?.asJavaFile()?.copyTo(dest, overwrite = true)
            }
            val meta = pendingFileMeta.remove(payloadId) ?: "{}"
            emit("fileReceived", JSObject().put("path", dest.absolutePath).put("metadataJson", meta))
            Log.i(TAG, "Tiedosto vastaanotettu: ${dest.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Vastaanotetun tiedoston tallennus epäonnistui", e)
        }
    }

    private fun resolveFile(path: String): File? {
        return try {
            when {
                path.startsWith("file://") -> File(Uri.parse(path).path ?: return null)
                path.startsWith("content://") -> {
                    val tmp = File(context.cacheDir, "send_${System.currentTimeMillis()}.mp4")
                    context.contentResolver.openInputStream(Uri.parse(path))?.use { input ->
                        FileOutputStream(tmp).use { output -> input.copyTo(output) }
                    }
                    tmp
                }
                else -> File(path)
            }.takeIf { it.exists() }
        } catch (e: Exception) {
            Log.e(TAG, "resolveFile epäonnistui", e)
            null
        }
    }

    private fun emitStatus() {
        emit("statusChanged", currentStatus())
    }
}
