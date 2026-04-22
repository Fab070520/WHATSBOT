import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from "@whiskeysockets/baileys";

import fs from "fs";
import qrcode from "qrcode-terminal";
import sharp from "sharp";
import ytdlp from "yt-dlp-exec";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

ffmpeg.setFfmpegPath(ffmpegPath);

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

  // 🔥 CONEXIÓN + RECONEXIÓN
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
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("❌ CONEXIÓN CERRADA, reconectando...", reason);

      // 🔥 evita loops locos
      setTimeout(() => start(), 5000);
    }
  });

  // 🤖 MENSAJES
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;

    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption ||
      "";

    console.log("📩 MENSAJE:", text);

    try {
      // ========================
      // 📸 COMANDO STICKER
      // ========================
      if (text.toLowerCase() === ".sticker") {
        esperandoImagen[from] = true;

        await sock.sendMessage(from, {
          text: "📸 Envíame la imagen para hacer sticker"
        });
        return;
      }

      // ========================
      // 📸 RECIBIR IMAGEN
      // ========================
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

        console.log("✅ Sticker enviado");
        return;
      }

      // ========================
      // 🎵 COMANDO MUSICA
      // ========================
      if (text.toLowerCase().startsWith(".music")) {
        const query = text.replace(".music", "").trim();

        if (!query) {
          await sock.sendMessage(from, {
            text: "❌ Escribe el nombre de la canción"
          });
          return;
        }

        await sock.sendMessage(from, {
          text: "⏳ Descargando música..."
        });

        const url = `ytsearch1:${query}`;

        // 🔥 NOMBRE ÚNICO PARA EVITAR ERRORES
        const filename = `audio_${Date.now()}.mp3`;

        await ytdlp(url, {
          extractAudio: true,
          audioFormat: "mp3",
          output: filename,
          ffmpegLocation: ffmpegPath,
          noCheckCertificates: true,
          preferFreeFormats: true,
          addHeader: ["referer:youtube.com", "user-agent:googlebot"]
        });

        const audio = fs.readFileSync(filename);

        await sock.sendMessage(from, {
          audio: audio,
          mimetype: "audio/mpeg"
        });

        fs.unlinkSync(filename);

        console.log("✅ Música enviada");
        return;
      }

    } catch (err) {
      console.log("❌ ERROR:", err);

      await sock.sendMessage(from, {
        text: "❌ Error al descargar la música"
      });
    }
  });
}

start();