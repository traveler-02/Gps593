package ec.gps593.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UsbFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
