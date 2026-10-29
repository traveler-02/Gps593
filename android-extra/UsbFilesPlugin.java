package ec.gps593.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
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
