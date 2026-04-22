import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadContentFromMessage
} from "@whiskeysockets/baileys";

import fs from "fs";
import qrcode from "qrcode-terminal";
import sharp from "sharp";

// 🧠 estado por chat
let esperandoImagen = {};

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
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
      console.log("❌ Reconectando limpio...");
      start();
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
      // 🎵 MUSICA (API PRO)
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
          text: "🔎 Buscando música..."
        });

        try {
          // 🔥 BUSCAR VIDEO
          const searchRes = await fetch(`https://api.youtubedownloadapi.com/search?q=${encodeURIComponent(query)}`);
          const searchData = await searchRes.json();

          if (!searchData.results || searchData.results.length === 0) {
            throw new Error("No results");
          }

          const videoUrl = searchData.results[0].url;

          // 🔥 DESCARGAR AUDIO
          const dlRes = await fetch(`https://api.youtubedownloadapi.com/download?url=${encodeURIComponent(videoUrl)}&format=mp3`);
          const dlData = await dlRes.json();

          if (!dlData.link) {
            throw new Error("No download link");
          }

          // 🔥 BAJAR AUDIO
          const audioRes = await fetch(dlData.link);
          const buffer = Buffer.from(await audioRes.arrayBuffer());

          await sock.sendMessage(from, {
            audio: buffer,
            mimetype: "audio/mpeg"
          });

          console.log("🎵 música enviada");
        } catch (err) {
          console.log("❌ ERROR API:", err);

          await sock.sendMessage(from, {
            text: "❌ Error obteniendo la música"
          });
        }

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