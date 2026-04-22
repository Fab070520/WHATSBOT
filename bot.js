import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from "@whiskeysockets/baileys";

import fs from "fs";
import qrcode from "qrcode-terminal";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { execSync, exec } from "child_process";

ffmpeg.setFfmpegPath(ffmpegPath);

// 🔥 instalar TODO en runtime (clave Railway)
try {
  execSync("apt-get update && apt-get install -y python3 ffmpeg yt-dlp");
  console.log("✅ Python + ffmpeg + yt-dlp listos");
} catch (e) {
  console.log("⚠️ Dependencias ya instaladas");
}

// 🧠 estado por chat
let esperandoImagen = {};

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,

    // 🔥 estabilidad
    syncFullHistory: false,
    markOnlineOnConnect: true,
    keepAliveIntervalMs: 30000,
    browser: ["Railway Bot", "Chrome", "1.0.0"]
  });

  sock.ev.on("creds.update", saveCreds);

  // 🔥 conexión
  sock.ev.on("connection.update", async (update) => {
    const { connection, qr } = update;

    if (qr) {
      console.log("📱 ESCANEA EL QR:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      console.log("✅ BOT CONECTADO");
    }

    if (connection === "close") {
      console.log("❌ Reconectando...");
      setTimeout(() => start(), 5000);
    }
  });

  // 🤖 mensajes
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      "";

    console.log("📩:", text);

    try {
      // ========================
      // 📸 STICKER
      // ========================
      if (text.toLowerCase() === ".sticker") {
        esperandoImagen[from] = true;

        await sock.sendMessage(from, {
          text: "📸 Envíame la imagen"
        });
        return;
      }

      if (msg.message.imageMessage && esperandoImagen[from]) {
        esperandoImagen[from] = false;

        const stream = await downloadContentFromMessage(
          msg.message.imageMessage,
          "image"
        );

        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }

        const sticker = await sharp(buffer)
          .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .webp()
          .toBuffer();

        await sock.sendMessage(from, { sticker });
        console.log("✅ sticker enviado");
        return;
      }

      // ========================
      // 🎵 MUSICA (FIX REAL)
      // ========================
      if (text.toLowerCase().startsWith(".music")) {
        const query = text.replace(".music", "").trim();

        if (!query) {
          await sock.sendMessage(from, {
            text: "❌ Escribe una canción"
          });
          return;
        }

        await sock.sendMessage(from, {
          text: "⏳ Descargando música..."
        });

        const filename = `audio_${Date.now()}.mp3`;

        exec(
          `yt-dlp -x --audio-format mp3 -o "${filename}" "ytsearch1:${query}"`,
          async (error) => {
            if (error) {
              console.log("❌ yt-dlp error:", error);

              await sock.sendMessage(from, {
                text: "❌ Error descargando música"
              });
              return;
            }

            try {
              const audio = fs.readFileSync(filename);

              await sock.sendMessage(from, {
                audio: audio,
                mimetype: "audio/mpeg"
              });

              fs.unlinkSync(filename);

              console.log("🎵 música enviada");
            } catch (err) {
              console.log("❌ ERROR:", err);
            }
          }
        );

        return;
      }

    } catch (err) {
      console.log("❌ ERROR GENERAL:", err);

      await sock.sendMessage(from, {
        text: "❌ Ocurrió un error"
      });
    }
  });
}

start();