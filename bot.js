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
import { execSync } from "child_process";

ffmpeg.setFfmpegPath(ffmpegPath);

// 🔥 instalar python en runtime (clave para Railway)
try {
  execSync("apt-get update && apt-get install -y python3 ffmpeg");
  console.log("✅ Python/ffmpeg listos");
} catch (e) {
  console.log("⚠️ Python ya estaba o no se pudo instalar");
}

// 🧠 estado por chat
let esperandoImagen = {};

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false
  });

  sock.ev.on("creds.update", saveCreds);

  // 🔥 conexión
  sock.ev.on("connection.update", async (update) => {
    const { connection, qr, lastDisconnect } = update;

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
        return;
      }

      // ========================
      // 🎵 MUSICA
      // ========================
      if (text.toLowerCase().startsWith(".music")) {
        const query = text.replace(".music", "").trim();

        if (!query) {
          await sock.sendMessage(from, {
            text: "❌ Escribe canción"
          });
          return;
        }

        await sock.sendMessage(from, {
          text: "⏳ Descargando..."
        });

        // 🔥 importar yt-dlp dinámico
        let ytdlp;
        try {
          ytdlp = (await import("yt-dlp-exec")).default;
        } catch {
          await sock.sendMessage(from, {
            text: "❌ yt-dlp no disponible"
          });
          return;
        }

        const base = `audio_${Date.now()}`;
        const output = `${base}.%(ext)s`;

        await ytdlp(`ytsearch1:${query}`, {
          extractAudio: true,
          audioFormat: "mp3",
          output: output,
          ffmpegLocation: ffmpegPath
        });

        const file = fs.readdirSync(".").find(f => f.startsWith(base));

        if (!file) throw new Error("no audio");

        const audio = fs.readFileSync(file);

        await sock.sendMessage(from, {
          audio: audio,
          mimetype: "audio/mpeg"
        });

        fs.unlinkSync(file);

        console.log("🎵 enviada");
        return;
      }

    } catch (err) {
      console.log("❌ ERROR:", err);

      await sock.sendMessage(from, {
        text: "❌ Error"
      });
    }
  });
}

start();