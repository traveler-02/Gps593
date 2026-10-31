package ec.gps593.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.RandomAccessFile;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Lee archivos .pmtiles / .g593 directamente del pendrive o de la memoria, por rangos (sin copiarlos). */
@CapacitorPlugin(name = "UsbFiles")
public class UsbFilesPlugin extends Plugin {
    private static final Set<String> SKIP = new HashSet<>(Arrays.asList(
        "Android", "runtime", "user", "shell", "obb", "asec", "secure", "expand", "pass_through",
        "installer", "androidwritable", "LOST.DIR", "proc", "sys", "dev"));

    private LocationManager lm;
    private LocationListener listener;
    private volatile Location last;
    private volatile long lastRecv;   // cuándo llegó la última ubicación (reloj del sistema)
    private volatile long seq;        // número de ubicaciones recibidas

    private boolean hasLocPermission() {
        return Build.VERSION.SDK_INT < 23
            || getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void stopUpdates() {
        try { if (lm != null && listener != null) lm.removeUpdates(listener); } catch (Exception e) { /* nada */ }
        listener = null;
    }

    @Override
    protected void handleOnDestroy() { stopUpdates(); }

    /** Empieza a recibir la ubicación del GPS de Android (pide el permiso si falta). */
    @PluginMethod
    public void locationStart(PluginCall call) {
        JSObject r = new JSObject();
        boolean ok = hasLocPermission();
        r.put("granted", ok);
        if (!ok) {
            if (Build.VERSION.SDK_INT >= 23 && getActivity() != null) {
                getActivity().requestPermissions(new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, 594);
            }
            call.resolve(r);
            return;
        }
        stopUpdates();
        lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        listener = new LocationListener() {
            @Override public void onLocationChanged(Location l) {
                Location prev = last;
                if (prev == null || LocationManager.GPS_PROVIDER.equals(l.getProvider()) || l.getTime() - prev.getTime() > 10000) {
                    last = l; lastRecv = SystemClock.elapsedRealtime(); seq++;
                }
            }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
            @Override public void onProviderEnabled(String provider) { }
            @Override public void onProviderDisabled(String provider) { }
        };
        boolean gps = false, net = false;
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, listener, Looper.getMainLooper());
                gps = true;
            }
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 3000, 0, listener, Looper.getMainLooper());
                net = true;
            }
        } catch (SecurityException e) {
            r.put("granted", false);
        }
        r.put("gps", gps);
        r.put("network", net);
        call.resolve(r);
    }

    /** Última ubicación conocida (la más reciente que llegó del GPS o, si no hay, la guardada por Android). */
    @PluginMethod
    public void locationLast(PluginCall call) {
        Location l = last;
        if (l == null && hasLocPermission()) {
            try {
                LocationManager m = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
                l = m.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (l == null) l = m.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            } catch (SecurityException e) {
                l = null;
            }
        }
        JSObject r = new JSObject();
        r.put("has", l != null);
        if (l != null) {
            r.put("lat", l.getLatitude());
            r.put("lon", l.getLongitude());
            r.put("acc", l.hasAccuracy() ? (double) l.getAccuracy() : 50.0);
            r.put("speed", l.hasSpeed() ? (double) l.getSpeed() : -1.0);
            r.put("bearing", l.hasBearing() ? (double) l.getBearing() : -1.0);
            r.put("time", l.getTime());
            long age;
            if (l == last) age = SystemClock.elapsedRealtime() - lastRecv;
            else age = l.getElapsedRealtimeNanos() > 0 ? (SystemClock.elapsedRealtimeNanos() - l.getElapsedRealtimeNanos()) / 1000000L : -1L;
            r.put("age", age);
            r.put("seq", l == last ? seq : 0L);
            r.put("provider", String.valueOf(l.getProvider()));
        }
        call.resolve(r);
    }

    /** Deja de recibir ubicación (al salir de la app). */
    @PluginMethod
    public void locationStop(PluginCall call) {
        stopUpdates();
        call.resolve();
    }

    /** Pide el permiso de lectura de almacenamiento (Android 6+). */
    @PluginMethod
    public void access(PluginCall call) {
        boolean ok = true;
        if (Build.VERSION.SDK_INT >= 23) {
            ok = getContext().checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
            if (!ok && getActivity() != null) {
                getActivity().requestPermissions(new String[] { Manifest.permission.READ_EXTERNAL_STORAGE }, 593);
            }
        }
        JSObject r = new JSObject();
        r.put("granted", ok);
        call.resolve(r);
    }

    /** Busca *.pmtiles y *.g593 en /storage, /mnt/media_rw y /mnt (hasta 4 niveles). */
    @PluginMethod
    public void find(final PluginCall call) {
        new Thread(() -> {
            JSArray out = new JSArray();
            Set<String> seen = new HashSet<>();
            ArrayDeque<Object[]> queue = new ArrayDeque<>();
            for (String root : new String[] { "/storage", "/mnt/media_rw", "/mnt" }) queue.add(new Object[] { new File(root), 0 });
            int visited = 0;
            while (!queue.isEmpty() && visited < 4000) {
                Object[] item = queue.poll();
                File dir = (File) item[0];
                int depth = (Integer) item[1];
                String canon;
                try { canon = dir.getCanonicalPath(); } catch (Exception e) { continue; }
                if (!seen.add(canon)) continue;
                File[] list = dir.listFiles();
                if (list == null) continue;
                visited++;
                for (File f : list) {
                    String name = f.getName();
                    if (f.isDirectory()) {
                        if (depth < 4 && !SKIP.contains(name)) queue.add(new Object[] { f, depth + 1 });
                    } else {
                        String low = name.toLowerCase();
                        if (low.endsWith(".pmtiles") || low.endsWith(".g593")) {
                            JSObject o = new JSObject();
                            o.put("path", f.getPath());
                            o.put("name", name);
                            o.put("size", f.length());
                            out.put(o);
                        }
                    }
                }
            }
            JSObject res = new JSObject();
            res.put("files", out);
            call.resolve(res);
        }).start();
    }

    /** Lee length bytes desde offset; devuelve base64. */
    @PluginMethod
    public void read(PluginCall call) {
        String path = call.getString("path");
        long offset = call.getData().optLong("offset", 0);
        int length = call.getInt("length", 0);
        if (path == null || length <= 0) { call.reject("parámetros inválidos"); return; }
        try (RandomAccessFile f = new RandomAccessFile(path, "r")) {
            f.seek(offset);
            byte[] buf = new byte[length];
            int n = 0, r;
            while (n < length && (r = f.read(buf, n, length - n)) > 0) n += r;
            JSObject res = new JSObject();
            res.put("data", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
            call.resolve(res);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }
}
