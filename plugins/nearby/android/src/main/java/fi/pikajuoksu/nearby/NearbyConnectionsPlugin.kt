package fi.pikajuoksu.nearby

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability

/**
 * Capacitor-silta Nearby Connections -ominaisuudelle. Ohut kerros, joka
 * delegoi kaiken yhteyslogiikan [NearbyConnectionManager]ille ja välittää sen
 * tapahtumat JS-kerrokseen (notifyListeners).
 *
 * JS-rajapinta: src/plugins/NearbyConnections.ts
 */
@CapacitorPlugin(name = "NearbyConnections")
class NearbyConnectionsPlugin : Plugin() {

    private lateinit var manager: NearbyConnectionManager

    override fun load() {
        manager = NearbyConnectionManager(context) { event, data ->
            // Välitä natiivit tapahtumat JS:n addListener-kuuntelijoille.
            notifyListeners(event, data)
        }
    }

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val code = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
        call.resolve(JSObject().put("available", code == ConnectionResult.SUCCESS))
    }

    /** Pyytää tarvittavat ajonaikaiset oikeudet (API-tason mukaan). */
    @PluginMethod
    fun ensurePermissions(call: PluginCall) {
        val needed = neededPermissions().filter {
            ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            activity?.let { ActivityCompat.requestPermissions(it, needed.toTypedArray(), 7311) }
        }
        // ConnectionManager yrittää yhdistää uudelleen, joten luvat ehtivät
        // tulla myönnetyiksi seuraavaan yritykseen mennessä.
        call.resolve(JSObject().put("granted", needed.isEmpty()))
    }

    @PluginMethod
    fun startAdvertising(call: PluginCall) {
        val name = call.getString("name") ?: "Camera"
        val serviceId = call.getString("serviceId") ?: DEFAULT_SERVICE
        manager.startAdvertising(name, serviceId)
        call.resolve()
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        val name = call.getString("name") ?: "Viewer"
        val serviceId = call.getString("serviceId") ?: DEFAULT_SERVICE
        manager.startDiscovery(name, serviceId)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        manager.stop()
        call.resolve()
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val json = call.getString("json") ?: return call.reject("json puuttuu")
        manager.sendMessage(json)
        call.resolve()
    }

    @PluginMethod
    fun sendFile(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path puuttuu")
        val metadataJson = call.getString("metadataJson") ?: "{}"
        manager.sendFile(path, metadataJson)
        call.resolve()
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        call.resolve(manager.currentStatus())
    }

    private fun neededPermissions(): List<String> {
        val list = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            list.add(Manifest.permission.BLUETOOTH_ADVERTISE)
            list.add(Manifest.permission.BLUETOOTH_CONNECT)
            list.add(Manifest.permission.BLUETOOTH_SCAN)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            list.add(Manifest.permission.NEARBY_WIFI_DEVICES)
        }
        return list
    }

    companion object {
        private const val DEFAULT_SERVICE = "fi.pikajuoksu.startwatch.nearby"
    }
}
