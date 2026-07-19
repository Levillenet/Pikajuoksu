package fi.pikajuoksu.nearby

import android.content.Context
import android.net.Uri
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
 * Se hoitaa:
 *  - Advertisingin (Camera) ja Discoveryn (Viewer)
 *  - yhteyksien automaattisen hyväksynnän ja valvonnan
 *  - viestien (BYTES) ja videotiedostojen (FILE) siirron
 *  - siirron etenemisen raportoinnin
 *
 * Ei internetiä, IP-osoitteita, QR-koodeja eikä manuaalista määritystä.
 * Strategia P2P_STAR sallii myöhemmin usean kameran liittymisen yhteen
 * Vieweriin ilman uudelleenkirjoitusta.
 *
 * Kaikki tila muutetaan pääsäikeessä; Nearby-callbackit tulevat pääsäikeeseen.
 * Tapahtumat välitetään JS-kerrokseen [emit]-lambdan kautta.
 */
class NearbyConnectionManager(
    private val context: Context,
    private val emit: (event: String, data: JSObject) -> Unit,
) {
    companion object {
        private const val TAG = "NearbyConnManager"
        private val STRATEGY = Strategy.P2P_STAR
    }

    private val client: ConnectionsClient = Nearby.getConnectionsClient(context)

    /** Yhdistetyt vastapuolet (endpointId -> nimi). */
    private val connected = mutableMapOf<String, String>()

    /** Odottavat tiedostosiirtojen metatiedot (payloadId -> metadataJson). */
    private val pendingFileMeta = mutableMapOf<Long, String>()

    /** Vastaanotettavat tiedostohyötykuormat (payloadId -> Payload). */
    private val incomingFiles = mutableMapOf<Long, Payload>()

    private var localName: String = "FSD"
    private var serviceId: String = "fi.pikajuoksu.startwatch.nearby"
    private var role: String = "" // "camera" | "viewer"

    // ---- Julkinen rajapinta (pluginin kutsumat) ----

    fun startAdvertising(name: String, service: String) {
        localName = name
        serviceId = service
        role = "camera"
        val options = AdvertisingOptions.Builder().setStrategy(STRATEGY).build()
        client.startAdvertising(localName, serviceId, connectionLifecycle, options)
            .addOnSuccessListener { Log.i(TAG, "Advertising käynnissä") }
            .addOnFailureListener { e ->
                Log.e(TAG, "Advertising epäonnistui", e)
                emitStatus()
            }
        emitStatus()
    }

    fun startDiscovery(name: String, service: String) {
        localName = name
        serviceId = service
        role = "viewer"
        val options = DiscoveryOptions.Builder().setStrategy(STRATEGY).build()
        client.startDiscovery(serviceId, endpointDiscovery, options)
            .addOnSuccessListener { Log.i(TAG, "Discovery käynnissä") }
            .addOnFailureListener { e ->
                Log.e(TAG, "Discovery epäonnistui", e)
                emitStatus()
            }
        emitStatus()
    }

    fun stop() {
        try {
            client.stopAdvertising()
            client.stopDiscovery()
            client.stopAllEndpoints()
        } catch (e: Exception) {
            Log.w(TAG, "stop() virhe", e)
        }
        connected.clear()
        pendingFileMeta.clear()
        incomingFiles.clear()
        role = ""
        emitStatus()
    }

    /** Lähettää lyhyen viestin (BYTES) kaikille yhdistetyille. */
    fun sendMessage(json: String) {
        val payload = Payload.fromBytes(json.toByteArray(Charsets.UTF_8))
        for (endpointId in connected.keys) {
            client.sendPayload(endpointId, payload)
        }
    }

    /**
     * Lähettää videotiedoston. Ensin lähetetään BYTES-otsake, joka sisältää
     * tiedoston payload-id:n ja metatiedot, sitten itse FILE-hyötykuorma.
     * Vastaanottaja yhdistää nämä payload-id:n perusteella.
     */
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

    // ---- Nearby-callbackit ----

    private val connectionLifecycle = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            // Hyväksy yhteys automaattisesti (ei käyttäjän vahvistusta).
            client.acceptConnection(endpointId, payloadCallback)
        }

        override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
            if (resolution.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
                // Nimeä ei aina saada tässä; käytä endpointId:tä varanimenä.
                connected[endpointId] = connected[endpointId] ?: endpointId
                Log.i(TAG, "Yhdistetty: $endpointId")
            }
            emitStatus()
        }

        override fun onDisconnected(endpointId: String) {
            connected.remove(endpointId)
            Log.i(TAG, "Yhteys katkesi: $endpointId")
            emitStatus()
        }
    }

    private val endpointDiscovery = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            // Viewer löysi kameran → pyydä yhteyttä automaattisesti.
            connected[endpointId] = info.endpointName
            client.requestConnection(localName, endpointId, connectionLifecycle)
                .addOnFailureListener { e -> Log.w(TAG, "requestConnection epäonnistui", e) }
        }

        override fun onEndpointLost(endpointId: String) {
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

            // Raportoi eteneminen vain tiedostoille (isot siirrot).
            if (incomingFiles.containsKey(update.payloadId) || isOutgoingFile(update.payloadId)) {
                val ev = JSObject()
                    .put("bytesTransferred", transferred)
                    .put("totalBytes", total)
                    .put("fraction", fraction)
                    .put("done", done)
                    .put("direction", if (incomingFiles.containsKey(update.payloadId)) "incoming" else "outgoing")
                emit("transferProgress", ev)
            }

            // Kun vastaanotettu tiedosto valmistuu, tallenna ja ilmoita.
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
                // Otsake: talleta metatiedot tulevaa tiedostoa varten.
                pendingFileMeta[obj.getLong("payloadId")] = obj.getJSONObject("metadata").toString()
            } else {
                // Tavallinen protokollaviesti → välitä JS:lle.
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
                // Vanhemmilla laitteilla asJavaFile voi olla käytettävissä.
                @Suppress("DEPRECATION")
                filePayload.asFile()?.asJavaFile()?.copyTo(dest, overwrite = true)
            }
            val meta = pendingFileMeta.remove(payloadId) ?: "{}"
            emit(
                "fileReceived",
                JSObject().put("path", dest.absolutePath).put("metadataJson", meta),
            )
            Log.i(TAG, "Tiedosto vastaanotettu: ${dest.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Vastaanotetun tiedoston tallennus epäonnistui", e)
        }
    }

    /** Ratkaisee JS:stä tulevan polun/URIn File-olioksi. */
    private fun resolveFile(path: String): File? {
        return try {
            when {
                path.startsWith("file://") -> File(Uri.parse(path).path ?: return null)
                path.startsWith("content://") -> {
                    // Kopioi content-URI väliaikaistiedostoon lähetystä varten.
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

    private fun isOutgoingFile(payloadId: Long): Boolean {
        // Lähtevät tiedostot eivät ole incomingFiles-listassa; karkea heuristiikka.
        return role == "camera" && !incomingFiles.containsKey(payloadId)
    }

    private fun emitStatus() {
        emit("statusChanged", currentStatus())
    }
}
