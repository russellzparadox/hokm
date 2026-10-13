package ir.hokm.game;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.Inet4Address;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * A tiny mailbox relay for playing on one Wi-Fi: the host's phone runs it, every player's page talks to it over HTTP.
 *   POST /send?to=ID   body = text          appends to ID's mailbox
 *   GET  /recv?id=ID&after=N                long-poll (up to 15 s): {"next":M,"msgs":[...]}
 *   GET  /ping                              "hokm-relay"
 * Same protocol as test/relay.js.
 */
final class Relay {

    private static final class Box {
        int base = 0;
        final List<String> msgs = new ArrayList<>();
    }

    private final Map<String, Box> boxes = new HashMap<>();
    private final Object lock = new Object();
    private volatile ServerSocket server;
    private volatile boolean running;

    /** Starts listening; returns the port, or -1. */
    synchronized int start() {
        if (running) return server.getLocalPort();
        for (int port = 8765; port < 8775; port++) {
            try {
                server = new ServerSocket(port);
                running = true;
                final ServerSocket ss = server;
                Thread t = new Thread(() -> accept(ss), "hokm-relay");
                t.setDaemon(true);
                t.start();
                return port;
            } catch (Exception ignored) {
                // port busy, try the next one
            }
        }
        return -1;
    }

    synchronized void stop() {
        running = false;
        try {
            if (server != null) server.close();
        } catch (Exception ignored) {
            // already closed
        }
        server = null;
        synchronized (lock) {
            boxes.clear();
            lock.notifyAll();
        }
    }

    /** IPv4 addresses of this phone on its networks (Wi-Fi, hotspot), as a JSON array string. */
    static String localIps() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) out.add(a.getHostAddress());
                }
            }
        } catch (Exception ignored) {
            // no interfaces
        }
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < out.size(); i++) sb.append(i > 0 ? "," : "").append('"').append(out.get(i)).append('"');
        return sb.append(']').toString();
    }

    private void accept(ServerSocket ss) {
        while (running) {
            try {
                final Socket s = ss.accept();
                Thread t = new Thread(() -> handle(s), "hokm-relay-conn");
                t.setDaemon(true);
                t.start();
            } catch (Exception e) {
                if (!running) return;
            }
        }
    }

    private static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) >= 0) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) throw new Exception("line too long");
        }
        if (c < 0 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static Map<String, String> query(String q) {
        Map<String, String> m = new HashMap<>();
        if (q == null) return m;
        for (String part : q.split("&")) {
            int i = part.indexOf('=');
            try {
                if (i > 0) m.put(part.substring(0, i), URLDecoder.decode(part.substring(i + 1), "UTF-8"));
            } catch (Exception ignored) {
                // skip malformed pair
            }
        }
        return m;
    }

    private void handle(Socket s) {
        try {
            s.setSoTimeout(30000);
            InputStream in = s.getInputStream();
            OutputStream out = s.getOutputStream();
            String line = readLine(in);
            if (line == null) return;
            String[] rl = line.split(" ");
            if (rl.length < 2) return;
            int len = 0;
            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                if (h.toLowerCase().startsWith("content-length:")) len = Integer.parseInt(h.substring(15).trim());
            }
            byte[] body = new byte[Math.min(len, 1 << 20)];
            int got = 0;
            while (got < body.length) {
                int n = in.read(body, got, body.length - got);
                if (n < 0) break;
                got += n;
            }
            String path = rl[1], q = null;
            int qi = path.indexOf('?');
            if (qi >= 0) { q = path.substring(qi + 1); path = path.substring(0, qi); }
            Map<String, String> p = query(q);
            String method = rl[0];
            if (method.equals("OPTIONS")) {
                reply(out, 204, "text/plain", "");
            } else if (path.equals("/ping")) {
                reply(out, 200, "text/plain", "hokm-relay");
            } else if (path.equals("/send") && method.equals("POST")) {
                String msg = new String(body, 0, got, StandardCharsets.UTF_8);
                synchronized (lock) {
                    Box b = boxes.get(p.get("to"));
                    if (b == null) { b = new Box(); boxes.put(String.valueOf(p.get("to")), b); }
                    b.msgs.add(msg);
                    lock.notifyAll();
                }
                reply(out, 200, "text/plain", "ok");
            } else if (path.equals("/recv")) {
                int after = 0;
                try { after = Integer.parseInt(p.get("after")); } catch (Exception ignored) { /* 0 */ }
                reply(out, 200, "application/json", recv(String.valueOf(p.get("id")), after));
            } else {
                reply(out, 404, "text/plain", "no");
            }
        } catch (Exception ignored) {
            // client went away
        } finally {
            try { s.close(); } catch (Exception ignored) { /* closed */ }
        }
    }

    private String recv(String id, int after) throws InterruptedException {
        long end = System.currentTimeMillis() + 15000;
        synchronized (lock) {
            Box b = boxes.get(id);
            if (b == null) { b = new Box(); boxes.put(id, b); }
            int drop = Math.max(0, Math.min(after - b.base, b.msgs.size()));
            if (drop > 0) { b.msgs.subList(0, drop).clear(); b.base += drop; }
            while (running && after >= b.base + b.msgs.size()) {
                long left = end - System.currentTimeMillis();
                if (left <= 0) break;
                lock.wait(left);
            }
            int from = Math.max(0, after - b.base);
            StringBuilder sb = new StringBuilder("{\"next\":").append(b.base + b.msgs.size()).append(",\"msgs\":[");
            for (int i = from; i < b.msgs.size(); i++) {
                if (i > from) sb.append(',');
                sb.append(quote(b.msgs.get(i)));
            }
            return sb.append("]}").toString();
        }
    }

    private static String quote(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        return sb.append('"').toString();
    }

    private static void reply(OutputStream out, int code, String type, String body) throws Exception {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : code == 204 ? " No Content" : " Not Found") + "\r\n" +
                "Content-Type: " + type + "; charset=utf-8\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Access-Control-Allow-Headers: *\r\n" +
                "Cache-Control: no-store\r\n" +
                "Content-Length: " + b.length + "\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }
}
